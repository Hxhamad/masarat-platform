/**
 * useFIRFilter — Spatial filtering hook
 *
 * When FIR layer is enabled and FIRs are selected, this hook filters the
 * flight list to only include aircraft physically inside the selected
 * FIR polygons.
 *
 * Performance:
 *  - <= WORKER_THRESHOLD flights: inline on main thread (no worker overhead)
 *  - > WORKER_THRESHOLD flights: offloaded to WebWorker to avoid jank
 *  - Bounding-box pre-filter always runs first (eliminates ~80% cheaply)
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Feature, Polygon, MultiPolygon } from '@turf/helpers';
import { useFIRStore } from '../stores/firStore';
import { getFIRFeature, getFIRBounds } from '../lib/firService';
import type { ADSBFlight } from '../types/flight';
import type { FIRWorkerRequest, FIRWorkerResponse } from '../lib/firFilterWorker';

const WORKER_THRESHOLD = 500;

export function useFIRFilter(flights: ADSBFlight[]): ADSBFlight[] {
  const firLayerEnabled = useFIRStore((s) => s.firLayerEnabled);
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const [workerResult, setWorkerResult] = useState<Set<string> | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Build FIR data for filtering (memoised on selection change)
  const selectedFIRData = useMemo(() => {
    if (!firLayerEnabled || selectedFIRs.length === 0) return null;

    return selectedFIRs
      .map((id) => {
        const feature = getFIRFeature(id);
        const bounds = getFIRBounds(id);
        if (!feature || !bounds) return null;
        return { id, geometry: feature.geometry, bounds };
      })
      .filter(Boolean) as FIRWorkerRequest['firs'];
  }, [firLayerEnabled, selectedFIRs]);

  // Inline filter for small flight counts
  const inlineFilter = useCallback(
    (flights: ADSBFlight[], firData: FIRWorkerRequest['firs']): ADSBFlight[] => {
      return flights.filter((f) => {
        for (const fir of firData) {
          // Bbox pre-filter
          const { minLat, maxLat, minLng, maxLng } = fir.bounds;
          if (f.latitude < minLat || f.latitude > maxLat || f.longitude < minLng || f.longitude > maxLng) {
            continue;
          }
          // Exact test
          const pt = point([f.longitude, f.latitude]);
          const feat: Feature<Polygon | MultiPolygon> = {
            type: 'Feature',
            properties: {},
            geometry: fir.geometry,
          };
          if (booleanPointInPolygon(pt, feat)) return true;
        }
        return false;
      });
    },
    [],
  );

  // Worker-based filter for large flight counts
  useEffect(() => {
    if (!selectedFIRData || selectedFIRData.length === 0 || flights.length <= WORKER_THRESHOLD) {
      setWorkerResult(null);
      return;
    }

    // Create worker (Vite handles ?worker imports, but we use URL constructor for compat)
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../lib/firFilterWorker.ts', import.meta.url),
        { type: 'module' },
      );
    }

    const worker = workerRef.current;

    const handler = (e: MessageEvent<FIRWorkerResponse>) => {
      setWorkerResult(new Set(e.data.insideIds));
    };
    worker.addEventListener('message', handler);

    const request: FIRWorkerRequest = {
      flights: flights.map((f) => ({ icao24: f.icao24, lat: f.latitude, lng: f.longitude })),
      firs: selectedFIRData,
    };
    worker.postMessage(request);

    return () => {
      worker.removeEventListener('message', handler);
    };
  }, [flights, selectedFIRData]);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Return filtered flights
  return useMemo(() => {
    // FIR filtering disabled or no FIRs selected → pass through
    if (!firLayerEnabled || !selectedFIRData || selectedFIRData.length === 0) {
      return flights;
    }

    // Small set: inline
    if (flights.length <= WORKER_THRESHOLD) {
      return inlineFilter(flights, selectedFIRData);
    }

    // Large set: use worker result (may be stale for one frame)
    if (workerResult) {
      return flights.filter((f) => workerResult.has(f.icao24));
    }

    // Worker hasn't responded yet — show all (first render only)
    return flights;
  }, [flights, firLayerEnabled, selectedFIRData, workerResult, inlineFilter]);
}
