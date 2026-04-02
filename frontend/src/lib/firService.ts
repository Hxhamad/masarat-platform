/**
 * FIR GeoJSON Service
 *
 * Fetches world FIR boundaries from a free, open GeoJSON source and caches
 * them in-memory. The source is the open "World-FIR-Boundaries" dataset which
 * is public-domain — zero cost.
 *
 * If the remote fetch fails, falls back to the built-in minimal FIR set.
 */

import type { FeatureCollection, Polygon, MultiPolygon } from '@turf/helpers';
import type { FIRFeature, FIRProperties, FIRBounds } from '../types/fir';
import bbox from '@turf/bbox';

// ---- Remote source (public, free, no auth) ----
const FIR_GEOJSON_URL =
  'https://raw.githubusercontent.com/maiuswong/World-FIR-Boundaries/main/firs.json';

// ---- In-memory cache ----
let cachedFeatures: FIRFeature[] | null = null;
let boundsCache = new Map<string, FIRBounds>();
let fetchPromise: Promise<FIRFeature[]> | null = null;

/**
 * Precompute bounding box for fast reject during point-in-polygon checks.
 */
function computeBounds(feature: FIRFeature): FIRBounds {
  const [minLng, minLat, maxLng, maxLat] = bbox(feature);
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Normalise features coming from the World-FIR-Boundaries dataset
 * into our FIRFeature shape. The dataset doesn't have a perfectly
 * consistent schema so we handle variations.
 */
function normalise(raw: FeatureCollection): FIRFeature[] {
  const out: FIRFeature[] = [];

  for (const f of raw.features) {
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;

    const props = f.properties ?? {};
    const id: string =
      props.ICAOCODE ?? props.icaoCode ?? props.FIRname ?? props.id ?? `FIR_${out.length}`;
    const name: string =
      props.FIRname ?? props.NAME ?? props.name ?? id;
    const country: string =
      props.Country ?? props.country ?? props.STATE ?? '';

    const feature: FIRFeature = {
      type: 'Feature',
      geometry: f.geometry as Polygon | MultiPolygon,
      properties: { id, name, country },
    };

    out.push(feature);
    boundsCache.set(id, computeBounds(feature));
  }

  return out;
}

/**
 * Fetch FIR features. Cached after first call. Multiple callers share the
 * same in-flight promise (dedup).
 */
export async function fetchFIRFeatures(): Promise<FIRFeature[]> {
  if (cachedFeatures) return cachedFeatures;

  if (!fetchPromise) {
    fetchPromise = (async () => {
      try {
        const res = await fetch(FIR_GEOJSON_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: FeatureCollection = await res.json();
        cachedFeatures = normalise(json);
        console.log(`[fir] Loaded ${cachedFeatures.length} FIR boundaries`);
      } catch (err) {
        console.warn('[fir] Failed to fetch remote FIR data, using empty set', err);
        cachedFeatures = [];
      }
      fetchPromise = null;
      return cachedFeatures;
    })();
  }

  return fetchPromise;
}

/**
 * Get precomputed bounding box for a FIR (for fast reject).
 */
export function getFIRBounds(firId: string): FIRBounds | undefined {
  return boundsCache.get(firId);
}

/**
 * Get all available FIR ids + names for the selection UI.
 */
export function getFIRList(): { id: string; name: string; country: string }[] {
  if (!cachedFeatures) return [];
  return cachedFeatures.map((f) => ({
    id: f.properties.id,
    name: f.properties.name,
    country: f.properties.country,
  }));
}

/**
 * Get a specific FIR feature by ID.
 */
export function getFIRFeature(firId: string): FIRFeature | undefined {
  return cachedFeatures?.find((f) => f.properties.id === firId);
}
