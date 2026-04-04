import type { ADSBFlight, ReadsBResponse, OpenSkyResponse, AggregatorStats } from '../types.js';
import { normalizeReadsB, normalizeOpenSky } from './normalizer.js';
import { flightCache } from './cache.js';
import { insertTrailPoint } from '../db/sqlite.js';

type DataSource = 'adsb-lol' | 'airplanes-live' | 'opensky';

interface SourceConfig {
  name: DataSource;
  url: string;
  normalize: (data: unknown) => ADSBFlight[];
  rateLimit: number; // ms between requests
}

const sources: SourceConfig[] = [
  {
    name: 'adsb-lol',
    url: 'https://api.adsb.lol/v2/lat/46/lon/2/dist/1200',
    normalize: (d) => normalizeReadsB(d as ReadsBResponse),
    rateLimit: 4_000,
  },
  {
    name: 'airplanes-live',
    url: 'https://api.airplanes.live/v2/point/46/2/1200',
    normalize: (d) => normalizeReadsB(d as ReadsBResponse),
    rateLimit: 4_000,
  },
  {
    name: 'opensky',
    url: 'https://opensky-network.org/api/states/all',
    normalize: (d) => normalizeOpenSky(d as OpenSkyResponse),
    rateLimit: 12_000,
  },
];

let activeSourceIndex = 0;
let lastFetchTime = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let onUpdate: ((flights: ADSBFlight[], removed: string[]) => void) | null = null;

const stats: AggregatorStats = {
  totalFlights: 0,
  dataSource: 'adsb-lol',
  lastUpdate: 0,
  messagesPerSecond: 0,
};

let messageCount = 0;
let mpsWindowStart = Date.now();

// Operational metrics (cumulative)
let totalFlightsProcessed = 0;
let totalErrors = 0;
const startTime = Date.now();

export function getOperationalMetrics() {
  return {
    uptimeMs: Date.now() - startTime,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    totalFlightsProcessed,
    totalErrors,
    activeSource: stats.dataSource,
    lastUpdate: stats.lastUpdate,
    messagesPerSecond: stats.messagesPerSecond,
    currentFlightsInCache: stats.totalFlights,
  };
}

export function getStats(): AggregatorStats {
  return { ...stats };
}

export function setUpdateCallback(cb: (flights: ADSBFlight[], removed: string[]) => void): void {
  onUpdate = cb;
}

function applySnapshot(sourceName: DataSource, flights: ADSBFlight[]): void {
  // Update cache
  for (const f of flights) {
    const existing = flightCache.get(f.icao24);
    if (existing && existing.trail.length > 0) {
      f.trail = existing.trail;
    }
    flightCache.set(f);

    if (f.latitude && f.longitude) {
      if (!existing ||
          Math.abs(existing.latitude - f.latitude) > 0.001 ||
          Math.abs(existing.longitude - f.longitude) > 0.001) {
        insertTrailPoint(f.icao24, f.latitude, f.longitude, f.altitude, f.timestamp);
      }
    }
  }

  const removed = flightCache.evictStale();

  stats.totalFlights = flightCache.size;
  stats.dataSource = sourceName;
  stats.lastUpdate = Date.now();
  messageCount += flights.length;
  totalFlightsProcessed += flights.length;

  const mpsElapsed = (Date.now() - mpsWindowStart) / 1000;
  if (mpsElapsed >= 5) {
    stats.messagesPerSecond = Math.round(messageCount / mpsElapsed);
    messageCount = 0;
    mpsWindowStart = Date.now();
  }

  if (onUpdate) onUpdate(flights, removed);
}

async function primeInitialSnapshot(): Promise<void> {
  const bootstrapSource = sources.find((source) => source.name === 'opensky');
  if (!bootstrapSource) return;

  try {
    const flights = await fetchFromSource(bootstrapSource);
    applySnapshot(bootstrapSource.name, flights);
    console.log(`[aggregator] Primed cache with ${flights.length} flights from ${bootstrapSource.name}`);
  } catch (err) {
    console.warn(`[aggregator] Initial prime failed for ${bootstrapSource.name}:`, (err as Error).message);
  }
}

async function fetchFromSource(source: SourceConfig): Promise<ADSBFlight[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return source.normalize(data);
  } finally {
    clearTimeout(timeout);
  }
}

async function poll(): Promise<void> {
  const source = sources[activeSourceIndex];
  const now = Date.now();

  // Respect rate limit
  const elapsed = now - lastFetchTime;
  if (elapsed < source.rateLimit) {
    schedulePoll(source.rateLimit - elapsed);
    return;
  }

  try {
    const flights = await fetchFromSource(source);
    lastFetchTime = Date.now();
    applySnapshot(source.name, flights);

    // Reset to primary on success if we were on fallback
    if (activeSourceIndex > 0) {
      // Try primary again after 60s
      setTimeout(() => { activeSourceIndex = 0; }, 60_000);
    }

    schedulePoll(source.rateLimit);
  } catch (err) {
    console.error(`[aggregator] ${source.name} failed:`, (err as Error).message);
    totalErrors++;
    // Failover to next source
    activeSourceIndex = (activeSourceIndex + 1) % sources.length;
    console.log(`[aggregator] Switching to ${sources[activeSourceIndex].name}`);
    schedulePoll(1_000); // Retry quickly with new source
  }
}

function schedulePoll(delay: number): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, delay);
}

export function startAggregator(): void {
  console.log(`[aggregator] Starting with primary source: ${sources[0].name}`);
  void primeInitialSnapshot();
  poll();
}

export function stopAggregator(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[aggregator] Stopped');
}
