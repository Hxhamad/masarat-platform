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
    url: 'https://api.adsb.lol/v2/lat/50/lon/10/dist/250',
    normalize: (d) => normalizeReadsB(d as ReadsBResponse),
    rateLimit: 5_000,
  },
  {
    name: 'airplanes-live',
    url: 'https://api.airplanes.live/v2/point/50/10/250',
    normalize: (d) => normalizeReadsB(d as ReadsBResponse),
    rateLimit: 5_000,
  },
  {
    name: 'opensky',
    url: 'https://opensky-network.org/api/states/all',
    normalize: (d) => normalizeOpenSky(d as OpenSkyResponse),
    rateLimit: 10_000,
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

export function getStats(): AggregatorStats {
  return { ...stats };
}

export function setUpdateCallback(cb: (flights: ADSBFlight[], removed: string[]) => void): void {
  onUpdate = cb;
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

    // Update cache
    for (const f of flights) {
      const existing = flightCache.get(f.icao24);
      // Merge trail from existing
      if (existing && existing.trail.length > 0) {
        f.trail = existing.trail;
      }
      flightCache.set(f);

      // Store trail point if position changed significantly
      if (f.latitude && f.longitude) {
        if (!existing ||
            Math.abs(existing.latitude - f.latitude) > 0.001 ||
            Math.abs(existing.longitude - f.longitude) > 0.001) {
          insertTrailPoint(f.icao24, f.latitude, f.longitude, f.altitude, f.timestamp);
        }
      }
    }

    // Evict stale aircraft
    const removed = flightCache.evictStale();

    // Update stats
    stats.totalFlights = flightCache.size;
    stats.dataSource = source.name;
    stats.lastUpdate = Date.now();
    messageCount += flights.length;
    const mpsElapsed = (Date.now() - mpsWindowStart) / 1000;
    if (mpsElapsed >= 5) {
      stats.messagesPerSecond = Math.round(messageCount / mpsElapsed);
      messageCount = 0;
      mpsWindowStart = Date.now();
    }

    // Notify listeners
    if (onUpdate) onUpdate(flights, removed);

    // Reset to primary on success if we were on fallback
    if (activeSourceIndex > 0) {
      // Try primary again after 60s
      setTimeout(() => { activeSourceIndex = 0; }, 60_000);
    }

    schedulePoll(source.rateLimit);
  } catch (err) {
    console.error(`[aggregator] ${source.name} failed:`, (err as Error).message);
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
  poll();
}

export function stopAggregator(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[aggregator] Stopped');
}
