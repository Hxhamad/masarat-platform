import type { ADSBFlight, ReadsBResponse, OpenSkyResponse, AggregatorStats } from '../types.js';
import { normalizeReadsB, normalizeOpenSky } from './normalizer.js';
import { flightCache } from './cache.js';
import { insertTrailPoint } from '../db/sqlite.js';

type DataSource = 'adsb-lol' | 'airplanes-live' | 'opensky';

interface Region {
  lat: number;
  lon: number;
  dist: number;
}

interface SourceConfig {
  name: DataSource;
  buildUrls: (regions: Region[]) => string[];
  normalize: (data: unknown) => ADSBFlight[];
  rateLimit: number; // ms between requests
}

/**
 * Parse ADSB_REGIONS env var. Format: "lat:lon:dist,lat:lon:dist,..."
 * Default covers Europe + South Asia (India/Middle-East).
 */
function parseRegions(): Region[] {
  const raw = process.env.ADSB_REGIONS ?? '';
  if (raw.trim()) {
    const regions: Region[] = [];
    for (const part of raw.split(',')) {
      const [latStr, lonStr, distStr] = part.trim().split(':');
      const lat = Number(latStr);
      const lon = Number(lonStr);
      const dist = Number(distStr);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(dist) || dist <= 0) {
        console.warn(`[aggregator] Skipping invalid region: "${part.trim()}"`);
        continue;
      }
      regions.push({ lat, lon, dist });
    }
    if (regions.length > 0) return regions;
    console.warn('[aggregator] No valid regions parsed from ADSB_REGIONS, using defaults');
  }
  // Defaults: Europe + South/Central Asia
  return [
    { lat: 46, lon: 2, dist: 1200 },   // Europe
    { lat: 22, lon: 78, dist: 1800 },   // India / South Asia
  ];
}

const configuredRegions = parseRegions();
console.log(`[aggregator] Configured ${configuredRegions.length} region(s):`,
  configuredRegions.map((r) => `${r.lat}°/${r.lon}°/${r.dist}nm`).join(', '));

const sources: SourceConfig[] = [
  {
    name: 'adsb-lol',
    buildUrls: (regions) => regions.map((r) =>
      `https://api.adsb.lol/v2/lat/${r.lat}/lon/${r.lon}/dist/${r.dist}`),
    normalize: (d) => normalizeReadsB(d as ReadsBResponse),
    rateLimit: 4_000,
  },
  {
    name: 'airplanes-live',
    buildUrls: (regions) => regions.map((r) =>
      `https://api.airplanes.live/v2/point/${r.lat}/${r.lon}/${r.dist}`),
    normalize: (d) => normalizeReadsB(d as ReadsBResponse),
    rateLimit: 4_000,
  },
  {
    name: 'opensky',
    buildUrls: () => ['https://opensky-network.org/api/states/all'],
    normalize: (d) => normalizeOpenSky(d as OpenSkyResponse),
    rateLimit: 12_000,
  },
];

let activeSourceIndex = 0;
let lastFetchTime = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let onUpdate: ((flights: ADSBFlight[], removed: string[]) => void) | null = null;
const updateListeners = new Set<(flights: ADSBFlight[], removed: string[]) => void>();

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

export function addUpdateListener(cb: (flights: ADSBFlight[], removed: string[]) => void): () => void {
  updateListeners.add(cb);
  return () => {
    updateListeners.delete(cb);
  };
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
  for (const listener of updateListeners) {
    listener(flights, removed);
  }
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
  const urls = source.buildUrls(configuredRegions);
  const allFlights: ADSBFlight[] = [];
  const seen = new Set<string>();

  // Fetch all regions in parallel (with individual timeouts)
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'Accept': 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return source.normalize(data);
      } finally {
        clearTimeout(timeout);
      }
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const f of result.value) {
        if (!seen.has(f.icao24)) {
          seen.add(f.icao24);
          allFlights.push(f);
        }
      }
    }
  }

  // If ALL regions failed, throw so failover logic kicks in
  const anySuccess = results.some((r) => r.status === 'fulfilled');
  if (!anySuccess) {
    const firstErr = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    throw new Error(firstErr?.reason?.message ?? 'All region fetches failed');
  }

  return allFlights;
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
