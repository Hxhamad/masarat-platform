/**
 * FIRLayer — Renders selected FIR boundary polygons on the Leaflet map.
 *
 * Features:
 *  - Zoom-adaptive styling (thicker borders at low zoom)
 *  - Selected-aircraft FIR highlight when an aircraft is selected
 */

import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { useFIRStore } from '../../stores/firStore';
import { useFlightStore } from '../../stores/flightStore';
import { getFIRFeature, resolveContainingFIR } from '../../lib/firService';
import { getMapInstance } from './mapRef';

function styleForZoom(zoom: number): L.PathOptions {
  const weight = zoom <= 4 ? 3 : zoom <= 6 ? 2.5 : 2;
  const fillOpacity = zoom <= 4 ? 0.1 : 0.06;
  return {
    color: '#4ea8c8',
    weight,
    opacity: 0.85,
    fillColor: '#4ea8c8',
    fillOpacity,
    dashArray: undefined,
  };
}

const HIGHLIGHT_STYLE: L.PathOptions = {
  color: '#e8b84b',
  weight: 3,
  opacity: 0.95,
  fillColor: '#e8b84b',
  fillOpacity: 0.08,
  dashArray: '8,4',
};

export default function FIRLayer() {
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const selectedFlight = useFlightStore((s) => s.selectedFlight);
  const flights = useFlightStore((s) => s.flights);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const geoJsonLayersRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const highlightLayerRef = useRef<L.GeoJSON | null>(null);
  const highlightFIRRef = useRef<string | null>(null);

  const updateStyles = useCallback(() => {
    const map = getMapInstance();
    if (!map) return;
    const zoom = map.getZoom();
    const style = styleForZoom(zoom);
    for (const layer of geoJsonLayersRef.current.values()) {
      layer.setStyle(style);
    }
  }, []);

  // Create / destroy layer group
  useEffect(() => {
    const map = getMapInstance();
    if (!map) return;

    if (!layerGroupRef.current) {
      layerGroupRef.current = L.layerGroup().addTo(map);
    }

    map.on('zoomend', updateStyles);

    return () => {
      map.off('zoomend', updateStyles);
      if (layerGroupRef.current) {
        layerGroupRef.current.remove();
        layerGroupRef.current = null;
      }
      geoJsonLayersRef.current.clear();
    };
  }, [updateStyles]);

  // Sync selected FIRs to map layers
  useEffect(() => {
    const map = getMapInstance();
    const group = layerGroupRef.current;
    if (!map || !group) return;

    const currentIds = new Set(selectedFIRs);
    const existingLayers = geoJsonLayersRef.current;
    const zoom = map.getZoom();
    const style = styleForZoom(zoom);

    // Remove deselected FIRs
    for (const [id, layer] of existingLayers) {
      if (!currentIds.has(id)) {
        group.removeLayer(layer);
        existingLayers.delete(id);
      }
    }

    // Add newly selected FIRs
    for (const id of selectedFIRs) {
      if (existingLayers.has(id)) continue;

      const feature = getFIRFeature(id);
      if (!feature) continue;

      const geoLayer = L.geoJSON(feature, {
        style: () => style,
        interactive: false,
      });

      group.addLayer(geoLayer);
      existingLayers.set(id, geoLayer);
    }
  }, [selectedFIRs]);

  // Selected-aircraft FIR highlight
  useEffect(() => {
    const map = getMapInstance();
    if (!map) return;

    // Remove old highlight
    if (highlightLayerRef.current) {
      highlightLayerRef.current.remove();
      highlightLayerRef.current = null;
      highlightFIRRef.current = null;
    }

    if (!selectedFlight) return;

    const flight = flights.get(selectedFlight);
    if (!flight) return;

    const firId = resolveContainingFIR(flight.latitude, flight.longitude);
    if (!firId) return;

    // Don't re-highlight if it's already a selected (monitored) FIR
    if (selectedFIRs.includes(firId)) return;

    const feature = getFIRFeature(firId);
    if (!feature) return;

    const geoLayer = L.geoJSON(feature, {
      style: () => HIGHLIGHT_STYLE,
      interactive: false,
    });
    geoLayer.addTo(map);
    highlightLayerRef.current = geoLayer;
    highlightFIRRef.current = firId;

    return () => {
      if (highlightLayerRef.current) {
        highlightLayerRef.current.remove();
        highlightLayerRef.current = null;
        highlightFIRRef.current = null;
      }
    };
  }, [selectedFlight, flights, selectedFIRs]);

  return null;
}
