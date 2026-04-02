/**
 * FIR GeoJSON Service
 *
 * Fetches world FIR boundaries from a free, open GeoJSON source and caches
 * them in-memory. The source is the open "World-FIR-Boundaries" dataset which
 * is public-domain — zero cost.
 *
 * If the remote fetch fails, falls back to the built-in minimal FIR set.
 */

import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { FIRFeature, FIRBounds } from '../types/fir';
import bbox from '@turf/bbox';

// ---- FIR sources (local bundled first, remote fallback) ----
const FIR_GEOJSON_URLS = [
  '/data/firs.geojson',
];

// Fallback: country boundaries as coarse regions if FIR dataset is unavailable.
const COUNTRY_GEOJSON_URL =
  'https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson';

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
      props.ICAOCODE ??
      props.icaoCode ??
      props.FIRname ??
      props.FIR ??
      props.id ??
      `FIR_${out.length}`;
    const name: string =
      props.FIRname ??
      props.FIR ??
      props.NAME ??
      props.name ??
      props.Name ??
      id;
    const country: string =
      props.Country ??
      props.country ??
      props.COUNTRY ??
      props.STATE ??
      props.state ??
      props.admin ??
      '';

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
 * Fallback normalizer that treats each country polygon as a coarse FIR region.
 */
function normaliseCountryFallback(raw: FeatureCollection): FIRFeature[] {
  const out: FIRFeature[] = [];

  for (const f of raw.features) {
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;

    const props = f.properties ?? {};
    const country = String(props.name ?? props.admin ?? props.name_long ?? '').trim();
    if (!country) continue;

    const code = String(props.iso_a2 ?? props.postal ?? props.iso_a3 ?? `C${out.length}`).trim();
    const id = `${code.toUpperCase()}-FIR`;

    const feature: FIRFeature = {
      type: 'Feature',
      geometry: f.geometry as Polygon | MultiPolygon,
      properties: {
        id,
        name: `${country} FIR`,
        country,
      },
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
      boundsCache = new Map<string, FIRBounds>();

      for (const url of FIR_GEOJSON_URLS) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json: FeatureCollection = await res.json();
          const normalised = normalise(json);
          if (normalised.length > 0) {
            cachedFeatures = normalised;
            console.log(`[fir] Loaded ${cachedFeatures.length} FIR boundaries from ${url}`);
            fetchPromise = null;
            return cachedFeatures;
          }
        } catch (err) {
          console.warn(`[fir] Failed to fetch FIR data from ${url}`, err);
        }
      }

      try {
        const res = await fetch(COUNTRY_GEOJSON_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: FeatureCollection = await res.json();
        cachedFeatures = normaliseCountryFallback(json);
        console.warn(
          `[fir] FIR dataset unavailable; loaded ${cachedFeatures.length} country-based fallback regions`,
        );
      } catch (err) {
        console.warn('[fir] Failed to load FIR and fallback datasets, using empty set', err);
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
