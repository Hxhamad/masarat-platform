import { latLngToCell } from 'h3-js';
import { addUpdateListener } from './adsbAggregator.js';
import { hexCellToPolygon, resolveHexResolution } from './hexGrid.js';
import type { Bounds } from './hexGrid.js';
import type { ADSBFlight } from '../types.js';

type RiskCategory = 'Low' | 'Guarded' | 'Elevated' | 'High' | 'Severe';

interface GnssQuery {
  bounds: Bounds;
  zoom: number;
  minutes: number;
}

interface GnssFeatureCollection {
  type: 'FeatureCollection';
  features: GnssFeature[];
}

interface GnssFeature {
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
  };
}

interface Observation {
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  track?: number;
  trueHeading?: number;
  groundSpeed: number;
  verticalRate: number;
  timestamp: number;
}

interface DropoutEvent {
  latitude: number;
  longitude: number;
  timestamp: number;
}

interface JammingMetrics {
  impossibleJump: number;
  jitter: number;
  smoothnessBreak: number;
  continuity: number;
  anomaly: number;
}

interface CellAccumulator {
  cellId: string;
  latestTimestamp: number;
  activeFlights: number;
  samplePoints: number;
  gnssImpossible: number;
  gnssJitter: number;
  gnssSmoothness: number;
  gnssContinuity: number;
  gnssDropouts: number;
  gnssAnomalyFlights: number;
}

const MAX_HISTORY_MS = 15 * 60_000;
const MAX_POINTS_PER_AIRCRAFT = 48;
const MAX_DROPOUT_MS = 10 * 60_000;
const MIN_OVERLAY_ALTITUDE_FT = 1_000;
const MAX_GNSS_CELLS = 120;

const historiesByAircraft = new Map<string, Observation[]>();
const recentDropouts: DropoutEvent[] = [];
let analyticsStarted = false;

export function startOverlayAnalytics(): void {
  if (analyticsStarted) return;

  addUpdateListener((flights, removed) => {
    const now = Date.now();

    for (const flight of flights) {
      upsertObservation(flight, now);
    }

    for (const icao24 of removed) {
      const history = historiesByAircraft.get(icao24);
      const last = history?.[history.length - 1];
      if (last) {
        recentDropouts.push({
          latitude: last.latitude,
          longitude: last.longitude,
          timestamp: now,
        });
      }
      historiesByAircraft.delete(icao24);
    }

    pruneState(now);
  });

  analyticsStarted = true;
  console.log('[overlay] GNSS overlay analytics initialized');
}

export function getGnssJammingRiskGeoJSON(query: GnssQuery): GnssFeatureCollection {
  const now = Date.now();
  pruneState(now);

  const cutoff = now - Math.min(query.minutes, 60) * 60_000;
  const resolution = resolveHexResolution(query.bounds, query.zoom, MAX_GNSS_CELLS);
  const cells = new Map<string, CellAccumulator>();

  for (const history of historiesByAircraft.values()) {
    const points = history.filter((point) => point.timestamp >= cutoff);
    if (points.length < 2) continue;

    const latest = points[points.length - 1];
    if (latest.altitude < MIN_OVERLAY_ALTITUDE_FT) continue;
    if (!isInsideBounds(latest.latitude, latest.longitude, query.bounds)) continue;

    const cell = getCellAccumulator(cells, latLngToCell(latest.latitude, latest.longitude, resolution));
    const gnss = computeJammingMetrics(points);

    cell.latestTimestamp = Math.max(cell.latestTimestamp, latest.timestamp);
    cell.activeFlights += 1;
    cell.samplePoints += points.length;
    cell.gnssImpossible += gnss.impossibleJump;
    cell.gnssJitter += gnss.jitter;
    cell.gnssSmoothness += gnss.smoothnessBreak;
    cell.gnssContinuity += gnss.continuity;
    if (gnss.anomaly >= 0.28) {
      cell.gnssAnomalyFlights += 1;
    }
  }

  for (const dropout of recentDropouts) {
    if (dropout.timestamp < cutoff) continue;
    if (!isInsideBounds(dropout.latitude, dropout.longitude, query.bounds)) continue;

    const cell = getCellAccumulator(cells, latLngToCell(dropout.latitude, dropout.longitude, resolution));
    cell.latestTimestamp = Math.max(cell.latestTimestamp, dropout.timestamp);
    cell.gnssDropouts += 1;
  }

  return {
    type: 'FeatureCollection',
    features: Array.from(cells.values())
      .map((cell) => buildCellFeature(cell))
      .filter((feature): feature is GnssFeature => feature !== null),
  };
}

function upsertObservation(flight: ADSBFlight, now: number): void {
  if (flight.isOnGround || flight.altitude < MIN_OVERLAY_ALTITUDE_FT) {
    historiesByAircraft.delete(flight.icao24);
    return;
  }

  const next: Observation = {
    latitude: flight.latitude,
    longitude: flight.longitude,
    altitude: flight.altitude,
    heading: flight.heading,
    track: flight.track,
    trueHeading: flight.trueHeading,
    groundSpeed: flight.groundSpeed,
    verticalRate: flight.verticalRate,
    timestamp: flight.timestamp,
  };

  const history = historiesByAircraft.get(flight.icao24) ?? [];
  const last = history[history.length - 1];

  if (last && next.timestamp <= last.timestamp) {
    history[history.length - 1] = next;
  } else {
    history.push(next);
  }

  const cutoff = now - MAX_HISTORY_MS;
  while (history.length > MAX_POINTS_PER_AIRCRAFT || (history[0] && history[0].timestamp < cutoff)) {
    history.shift();
  }

  if (history.length > 0) {
    historiesByAircraft.set(flight.icao24, history);
  }
}

function pruneState(now: number): void {
  const historyCutoff = now - MAX_HISTORY_MS;
  for (const [icao24, history] of historiesByAircraft) {
    const next = history.filter((point) => point.timestamp >= historyCutoff);
    if (next.length === 0) {
      historiesByAircraft.delete(icao24);
      continue;
    }
    if (next.length !== history.length) {
      historiesByAircraft.set(icao24, next.slice(-MAX_POINTS_PER_AIRCRAFT));
    }
  }

  for (let index = recentDropouts.length - 1; index >= 0; index--) {
    if (recentDropouts[index].timestamp < now - MAX_DROPOUT_MS) {
      recentDropouts.splice(index, 1);
    }
  }
}

function computeJammingMetrics(points: Observation[]): JammingMetrics {
  if (points.length < 2) {
    return {
      impossibleJump: 0,
      jitter: 0,
      smoothnessBreak: 0,
      continuity: 0,
      anomaly: 0,
    };
  }

  let impossibleJumps = 0;
  let jitterEvents = 0;
  let smoothnessBreaks = 0;
  let continuityGaps = 0;

  for (let index = 1; index < points.length; index++) {
    const prev = points[index - 1];
    const current = points[index];
    const dtSeconds = Math.max((current.timestamp - prev.timestamp) / 1000, 0.001);
    const dist = distanceNm(prev, current);
    const impliedSpeed = dist / (dtSeconds / 3600);
    const reportedSpeed = Math.max(prev.groundSpeed, current.groundSpeed, 0);
    const deltaTrack = angleDelta(resolveTrack(prev), resolveTrack(current));
    const altitudeDelta = Math.abs(current.altitude - prev.altitude);
    const speedDelta = Math.abs(current.groundSpeed - prev.groundSpeed);

    if (impliedSpeed > Math.max(900, reportedSpeed + 250)) {
      impossibleJumps += 1;
    }

    if (dtSeconds > 20) {
      continuityGaps += 1;
    }

    if (deltaTrack > 55 && dist < 3 && speedDelta < 80 && altitudeDelta < 1_500) {
      jitterEvents += 1;
    }

    if (deltaTrack > 80 && dist < 6) {
      smoothnessBreaks += 1;
    }
  }

  const segments = Math.max(points.length - 1, 1);
  const impossibleJump = clamp01((impossibleJumps / segments) * 2);
  const jitter = clamp01((jitterEvents / segments) * 1.8);
  const smoothnessBreak = clamp01((smoothnessBreaks / segments) * 1.4);
  const continuity = clamp01((continuityGaps / segments) * 2.4);
  const anomaly = clamp01(
    impossibleJump * 0.35 +
      jitter * 0.25 +
      smoothnessBreak * 0.20 +
      continuity * 0.20,
  );

  return {
    impossibleJump,
    jitter,
    smoothnessBreak,
    continuity,
    anomaly,
  };
}

function getCellAccumulator(cells: Map<string, CellAccumulator>, cellId: string): CellAccumulator {
  const existing = cells.get(cellId);
  if (existing) {
    return existing;
  }

  const next: CellAccumulator = {
    cellId,
    latestTimestamp: 0,
    activeFlights: 0,
    samplePoints: 0,
    gnssImpossible: 0,
    gnssJitter: 0,
    gnssSmoothness: 0,
    gnssContinuity: 0,
    gnssDropouts: 0,
    gnssAnomalyFlights: 0,
  };
  cells.set(cellId, next);
  return next;
}

function buildCellFeature(cell: CellAccumulator): GnssFeature | null {
  if (cell.activeFlights === 0) {
    return null;
  }

  const sampleFactor = clamp01(cell.activeFlights / 6);
  const densityFactor = clamp01(cell.samplePoints / 30);
  const corroboration = clamp01(cell.gnssAnomalyFlights / Math.max(cell.activeFlights, 1));
  const impossible = cell.gnssImpossible / cell.activeFlights;
  const jitter = cell.gnssJitter / cell.activeFlights;
  const smoothness = cell.gnssSmoothness / cell.activeFlights;
  const continuity = cell.gnssContinuity / cell.activeFlights;
  const dropoutSignal = clamp01(cell.gnssDropouts / Math.max(cell.activeFlights, 1));
  const score = Math.round(
    clamp01(
      impossible * 0.35 +
        jitter * 0.20 +
        smoothness * 0.20 +
        Math.max(continuity, dropoutSignal) * 0.15 +
        corroboration * 0.10,
    ) * 100,
  );
  const confidence = Math.round(
    clamp01(sampleFactor * 0.50 + densityFactor * 0.20 + Math.max(corroboration, dropoutSignal) * 0.30) * 100,
  );

  if (score < 10 || confidence < 10) {
    return null;
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: hexCellToPolygon(cell.cellId),
    },
    properties: {
      cellId: cell.cellId,
      score,
      confidence,
      factors: topFactors([
        { label: 'Impossible position jumps', value: impossible },
        { label: 'Track jitter cluster', value: jitter },
        { label: 'Trajectory smoothness breaks', value: smoothness },
        { label: 'Continuity disruption', value: Math.max(continuity, dropoutSignal) },
        { label: 'Cross-aircraft corroboration', value: corroboration },
      ]),
      updatedAt: cell.latestTimestamp,
      sampleSize: cell.activeFlights,
      category: scoreCategory(score),
    },
  };
}

function isInsideBounds(latitude: number, longitude: number, bounds: Bounds): boolean {
  return latitude >= bounds.south && latitude <= bounds.north && longitude >= bounds.west && longitude <= bounds.east;
}

function resolveTrack(point: Observation): number {
  return point.track ?? point.heading;
}

function angleDelta(a: number, b: number): number {
  const delta = Math.abs((a - b) % 360);
  return delta > 180 ? 360 - delta : delta;
}

function distanceNm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const earthRadiusKm = 6_371;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  const distanceKm = 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return distanceKm * 0.539957;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function topFactors(entries: Array<{ label: string; value: number }>): string[] {
  return entries
    .filter((entry) => entry.value >= 0.12)
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
    .map((entry) => entry.label);
}

function scoreCategory(score: number): RiskCategory {
  if (score <= 20) return 'Low';
  if (score <= 40) return 'Guarded';
  if (score <= 60) return 'Elevated';
  if (score <= 80) return 'High';
  return 'Severe';
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}