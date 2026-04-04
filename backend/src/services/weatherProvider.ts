import type { Bounds, HexCell } from './hexGrid.js';
import { viewportToHexCells } from './hexGrid.js';

type RiskCategory = 'Low' | 'Guarded' | 'Elevated' | 'High' | 'Severe';

interface WeatherQuery {
  bounds: Bounds;
  zoom: number;
}

interface OpenMeteoCurrentWeather {
  weatherCode: number | null;
  cloudCover: number | null;
  precipitation: number | null;
  windSpeed10m: number | null;
  windGusts10m: number | null;
  visibility: number | null;
  cape: number | null;
  freezingLevelHeight: number | null;
}

interface WeatherCacheEntry {
  data: OpenMeteoCurrentWeather;
  fetchedAt: number;
  normalizationOk: boolean;
}

interface WeatherFeatureCollection {
  type: 'FeatureCollection';
  features: WeatherFeature[];
}

interface WeatherFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  properties: {
    cellId: string;
    score: number;
    confidence: number;
    factors: string[];
    updatedAt: number;
    sampleSize: number;
    category: RiskCategory;
    source: 'Open-Meteo';
    stale: boolean;
  };
}

const WEATHER_PROVIDER = 'open-meteo';
const PROVIDER_MODE = 'current';
const CACHE_TTL_MS = 10 * 60_000;
const STALE_RETENTION_MS = 20 * 60_000;
const MAX_WEATHER_CELLS = 80;
const CHUNK_SIZE = 45;
const CURRENT_VARIABLES = [
  'weather_code',
  'cloud_cover',
  'precipitation',
  'wind_speed_10m',
  'wind_gusts_10m',
  'visibility',
  'cape',
  'freezing_level_height',
].join(',');

const weatherCache = new Map<string, WeatherCacheEntry>();
const inFlightRequests = new Map<string, Promise<Map<string, WeatherCacheEntry>>>();

function currentBucket(now: number): number {
  return Math.floor(now / CACHE_TTL_MS);
}

function cacheKey(cellId: string, bucket: number): string {
  return `${WEATHER_PROVIDER}:${PROVIDER_MODE}:${bucket}:${cellId}`;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeCurrentPayload(payload: unknown): OpenMeteoCurrentWeather {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};

  return {
    weatherCode: toNumber(record.weather_code),
    cloudCover: toNumber(record.cloud_cover),
    precipitation: toNumber(record.precipitation),
    windSpeed10m: toNumber(record.wind_speed_10m),
    windGusts10m: toNumber(record.wind_gusts_10m),
    visibility: toNumber(record.visibility),
    cape: toNumber(record.cape),
    freezingLevelHeight: toNumber(record.freezing_level_height),
  };
}

function extractCurrentItems(body: unknown): Array<Record<string, unknown> | undefined> {
  if (Array.isArray(body)) {
    return body.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
      const current = (item as Record<string, unknown>).current;
      return current && typeof current === 'object' && !Array.isArray(current)
        ? current as Record<string, unknown>
        : undefined;
    });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [];
  }

  const current = (body as Record<string, unknown>).current;
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return [];
  }

  return [current as Record<string, unknown>];
}

function pruneCache(now: number): void {
  for (const [key, entry] of weatherCache) {
    if (now - entry.fetchedAt > STALE_RETENTION_MS) {
      weatherCache.delete(key);
    }
  }
}

function findCacheEntry(cellId: string, now: number): { entry: WeatherCacheEntry; stale: boolean } | null {
  const bucket = currentBucket(now);
  const currentEntry = weatherCache.get(cacheKey(cellId, bucket));
  if (currentEntry) {
    return { entry: currentEntry, stale: false };
  }

  const previousEntry = weatherCache.get(cacheKey(cellId, bucket - 1));
  if (previousEntry) {
    return { entry: previousEntry, stale: true };
  }

  return null;
}

function buildChunkKey(cells: HexCell[], bucket: number): string {
  return `${WEATHER_PROVIDER}:${PROVIDER_MODE}:${bucket}:${cells.map((cell) => cell.cellId).sort().join('|')}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

async function fetchChunk(cells: HexCell[]): Promise<Map<string, WeatherCacheEntry>> {
  const latitudes = cells.map((cell) => cell.centerLat.toFixed(4)).join(',');
  const longitudes = cells.map((cell) => cell.centerLng.toFixed(4)).join(',');
  const url = [
    'https://api.open-meteo.com/v1/forecast',
    `?latitude=${latitudes}`,
    `&longitude=${longitudes}`,
    `&current=${CURRENT_VARIABLES}`,
    '&wind_speed_unit=kn',
    '&timeformat=unixtime',
    '&timezone=GMT',
    '&cell_selection=nearest',
  ].join('');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  const body = await response.json() as unknown;
  const currentItems = extractCurrentItems(body);
  const fetchedAt = Date.now();
  const results = new Map<string, WeatherCacheEntry>();

  for (let index = 0; index < cells.length; index++) {
    const current = normalizeCurrentPayload(currentItems[index]);
    const valueCount = [
      current.weatherCode,
      current.cloudCover,
      current.precipitation,
      current.windSpeed10m,
      current.windGusts10m,
      current.visibility,
      current.cape,
      current.freezingLevelHeight,
    ].filter((value) => value != null).length;

    results.set(cells[index].cellId, {
      data: current,
      fetchedAt,
      normalizationOk: valueCount > 0,
    });
  }

  return results;
}

async function fetchWeatherForCells(cells: HexCell[]): Promise<Map<string, { entry: WeatherCacheEntry; stale: boolean }>> {
  const now = Date.now();
  const bucket = currentBucket(now);
  pruneCache(now);

  const results = new Map<string, { entry: WeatherCacheEntry; stale: boolean }>();
  const missing: HexCell[] = [];

  for (const cell of cells) {
    const cached = findCacheEntry(cell.cellId, now);
    if (cached && !cached.stale) {
      results.set(cell.cellId, cached);
      continue;
    }
    missing.push(cell);
  }

  const groups = chunk(missing, CHUNK_SIZE);
  const settled = await Promise.allSettled(groups.map((group) => {
    const key = buildChunkKey(group, bucket);
    const existing = inFlightRequests.get(key);
    if (existing) {
      return existing;
    }

    const request = fetchChunk(group).finally(() => {
      inFlightRequests.delete(key);
    });
    inFlightRequests.set(key, request);
    return request;
  }));

  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    for (const [cellId, entry] of outcome.value) {
      weatherCache.set(cacheKey(cellId, bucket), entry);
      results.set(cellId, { entry, stale: false });
    }
  }

  for (const cell of cells) {
    if (results.has(cell.cellId)) continue;
    const cached = findCacheEntry(cell.cellId, now);
    if (cached) {
      results.set(cell.cellId, cached);
    }
  }

  return results;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scoreCategory(score: number): RiskCategory {
  if (score <= 20) return 'Low';
  if (score <= 40) return 'Guarded';
  if (score <= 60) return 'Elevated';
  if (score <= 80) return 'High';
  return 'Severe';
}

function describeWeatherCode(code: number): string {
  if (code === 95 || code === 96 || code === 99) return `Thunderstorm weather code ${code}`;
  if (code === 66 || code === 67) return `Freezing rain weather code ${code}`;
  if (code === 45 || code === 48) return `Fog weather code ${code}`;
  if (code >= 71 && code <= 86) return `Frozen precipitation code ${code}`;
  if (code >= 51 && code <= 65) return `Precipitation weather code ${code}`;
  return `Weather code ${code}`;
}

function wmoBaseSeverity(code: number | null): number {
  if (code == null) return 0;
  if (code <= 3) return 2;
  if (code === 45 || code === 48) return 38;
  if (code >= 51 && code <= 55) return code === 55 ? 32 : code === 53 ? 24 : 16;
  if (code === 56 || code === 57) return code === 57 ? 68 : 55;
  if (code === 61 || code === 63 || code === 65) return code === 65 ? 62 : code === 63 ? 40 : 24;
  if (code === 66 || code === 67) return code === 67 ? 82 : 70;
  if (code === 71 || code === 73 || code === 75) return code === 75 ? 70 : code === 73 ? 48 : 32;
  if (code === 77) return 44;
  if (code === 80 || code === 81 || code === 82) return code === 82 ? 72 : code === 81 ? 48 : 28;
  if (code === 85 || code === 86) return code === 86 ? 72 : 50;
  if (code === 95) return 82;
  if (code === 96 || code === 99) return 94;
  return 10;
}

function buildWeatherScore(entry: WeatherCacheEntry, stale: boolean): {
  score: number;
  confidence: number;
  factors: string[];
  category: RiskCategory;
} {
  const weather = entry.data;
  const factors: Array<{ label: string; value: number }> = [];

  const baseSeverity = wmoBaseSeverity(weather.weatherCode);
  if (weather.weatherCode != null && baseSeverity >= 12) {
    factors.push({ label: describeWeatherCode(weather.weatherCode), value: baseSeverity / 100 });
  }

  const gustSeverity = weather.windGusts10m == null
    ? 0
    : weather.windGusts10m >= 45 ? 0.95
    : weather.windGusts10m >= 35 ? 0.75
    : weather.windGusts10m >= 25 ? 0.45
    : weather.windGusts10m >= 15 ? 0.15
    : 0;
  if (weather.windGusts10m != null && gustSeverity > 0.14) {
    factors.push({ label: `Gusts ${Math.round(weather.windGusts10m)} kt`, value: gustSeverity });
  }

  const precipitationSeverity = weather.precipitation == null
    ? 0
    : weather.precipitation >= 8 ? 0.92
    : weather.precipitation >= 5 ? 0.72
    : weather.precipitation >= 2 ? 0.45
    : weather.precipitation >= 0.5 ? 0.18
    : 0;
  if (weather.precipitation != null && precipitationSeverity > 0.14) {
    factors.push({ label: `Precipitation ${weather.precipitation.toFixed(1)} mm`, value: precipitationSeverity });
  }

  const visibilitySeverity = weather.visibility == null
    ? 0
    : weather.visibility < 800 ? 0.95
    : weather.visibility < 1800 ? 0.78
    : weather.visibility < 5000 ? 0.45
    : weather.visibility < 8000 ? 0.18
    : 0;
  if (weather.visibility != null && visibilitySeverity > 0.14) {
    factors.push({ label: `Visibility ${Math.round(weather.visibility)} m`, value: visibilitySeverity });
  }

  const capeSeverity = weather.cape == null
    ? 0
    : weather.cape >= 2500 ? 0.95
    : weather.cape >= 1400 ? 0.72
    : weather.cape >= 700 ? 0.42
    : weather.cape >= 250 ? 0.16
    : 0;
  if (weather.cape != null && capeSeverity > 0.14) {
    factors.push({ label: `CAPE ${Math.round(weather.cape)} J/kg`, value: capeSeverity });
  }

  const freezingSeverity = weather.freezingLevelHeight == null || (weather.precipitation ?? 0) <= 0
    ? 0
    : weather.freezingLevelHeight < 700 ? 0.9
    : weather.freezingLevelHeight < 1600 ? 0.58
    : weather.freezingLevelHeight < 3000 ? 0.24
    : 0;
  if (weather.freezingLevelHeight != null && freezingSeverity > 0.14) {
    factors.push({ label: 'Low freezing level', value: freezingSeverity });
  }

  const score = Math.round(clamp01(
    (baseSeverity / 100) * 0.40 +
    gustSeverity * 0.22 +
    precipitationSeverity * 0.16 +
    visibilitySeverity * 0.12 +
    capeSeverity * 0.07 +
    freezingSeverity * 0.03,
  ) * 100);

  const completeness = [
    weather.weatherCode,
    weather.cloudCover,
    weather.precipitation,
    weather.windSpeed10m,
    weather.windGusts10m,
    weather.visibility,
    weather.cape,
    weather.freezingLevelHeight,
  ].filter((value) => value != null).length / 8;
  const freshness = stale ? 0.45 : 1;
  const normalization = entry.normalizationOk ? 1 : 0.35;
  const confidence = Math.round(clamp01(
    completeness * 0.65 + freshness * 0.20 + normalization * 0.15,
  ) * 100);

  return {
    score,
    confidence,
    factors: factors
      .sort((left, right) => right.value - left.value)
      .slice(0, 4)
      .map((factor) => factor.label),
    category: scoreCategory(score),
  };
}

export async function getWeatherRiskGeoJSON(query: WeatherQuery): Promise<WeatherFeatureCollection> {
  const cells = viewportToHexCells(query.bounds, query.zoom, MAX_WEATHER_CELLS);
  if (cells.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const weatherByCell = await fetchWeatherForCells(cells);
  const features: WeatherFeature[] = [];

  for (const cell of cells) {
    const cached = weatherByCell.get(cell.cellId);
    if (!cached) continue;

    const score = buildWeatherScore(cached.entry, cached.stale);
    if (score.score < 5) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: cell.polygon,
      },
      properties: {
        cellId: cell.cellId,
        score: score.score,
        confidence: score.confidence,
        factors: score.factors,
        updatedAt: cached.entry.fetchedAt,
        sampleSize: 1,
        category: score.category,
        source: 'Open-Meteo',
        stale: cached.stale,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}