import { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Map.css';
import type { ADSBFlight } from '../../types/flight';
import type { RiskFeatureCollection, RiskCellProperties, RiskOverlayKind } from '../../types/overlay';
import { useFlightStore } from '../../stores/flightStore';
import { useVisibleFlightStore } from '../../stores/visibleFlightStore';
import { useFIRStore } from '../../stores/firStore';
import { getFIRBounds } from '../../lib/firService';
import { flightTypeColor, formatAltitude, formatSpeed, displayCallsign } from '../../lib/utils';
import { setMapInstance } from './mapRef';
import FIRDiagnostics from './FIRDiagnostics';
import OverlayLegend from './OverlayLegend';

type BaseLayerConfig = {
  name: string;
  url: string;
  attribution: string;
  options?: L.TileLayerOptions;
  aeronautical?: boolean;
};

type RiskWindowMinutes = 15 | 30 | 60;

const OVERLAY_LABELS: Record<RiskOverlayKind, string> = {
  weather: 'Weather (Open-Meteo)',
  gnss: 'GNSS Jamming (ADS-B inferred)',
};

const iconCache = new Map<string, L.DivIcon>();

function bucketHeading(heading: number): number {
  return Math.round(heading / 10) * 10;
}

function getAircraftIcon(color: string, heading: number, selected: boolean): L.DivIcon {
  const h = bucketHeading(heading);
  const key = `${color}_${h}_${selected ? 1 : 0}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      html: `<div class="aircraft-icon ${selected ? 'aircraft-icon--selected' : ''}" style="transform: rotate(${h}deg)">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L8 10H3L5 13H8L10 20H14L16 13H19L21 10H16L12 2Z"/>
    </svg>
  </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      className: '',
    });
    iconCache.set(key, icon);
  }
  return icon;
}

const MAP_CENTER: L.LatLngExpression = [50, 10];

const configuredAeronauticalTileUrl = (import.meta.env.VITE_AERONAUTICAL_TILE_URL ?? '').trim();
const configuredAeronauticalTileName = (import.meta.env.VITE_AERONAUTICAL_TILE_NAME ?? 'Aeronautical Chart').trim();
const configuredAeronauticalAttribution = (
  import.meta.env.VITE_AERONAUTICAL_TILE_ATTRIBUTION ?? 'Aeronautical chart data'
).trim();

function createBaseLayerConfigs(): BaseLayerConfig[] {
  const configs: BaseLayerConfig[] = [];

  configs.push({
    name: 'Standard + FIR Borders',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com">CARTO</a>',
    options: { maxZoom: 18, subdomains: 'abcd' },
  });

  if (configuredAeronauticalTileUrl) {
    configs.push({
      name: configuredAeronauticalTileName,
      url: configuredAeronauticalTileUrl,
      attribution: configuredAeronauticalAttribution,
      aeronautical: true,
      options: {
        maxZoom: 18,
      },
    });
  }

  return configs;
}

function buildPopupHtml(flight: ADSBFlight): string {
  return `<div class="flight-popup-content">
    <div class="callsign">${displayCallsign(flight)}</div>
    <div class="row"><span class="label">ICAO</span><span>${flight.icao24.toUpperCase()}</span></div>
    ${flight.registration ? `<div class="row"><span class="label">Reg</span><span>${flight.registration}</span></div>` : ''}
    ${flight.aircraftType ? `<div class="row"><span class="label">Type</span><span>${flight.aircraftType}</span></div>` : ''}
    <div class="row"><span class="label">Alt</span><span>${formatAltitude(flight.altitude)}</span></div>
    <div class="row"><span class="label">Spd</span><span>${formatSpeed(flight.groundSpeed)}</span></div>
    <div class="row"><span class="label">Hdg</span><span>${Math.round(flight.heading)}°</span></div>
    <div class="row"><span class="label">V/S</span><span>${flight.verticalRate} fpm</span></div>
    ${flight.squawk ? `<div class="row"><span class="label">Sqk</span><span>${flight.squawk}</span></div>` : ''}
    <div class="row"><span class="label">Lat</span><span>${flight.latitude.toFixed(4)}</span></div>
    <div class="row"><span class="label">Lon</span><span>${flight.longitude.toFixed(4)}</span></div>
  </div>`;
}

function overlayColor(kind: RiskOverlayKind, score: number): string {
  if (kind === 'weather') {
    if (score <= 20) return '#2f855a';
    if (score <= 40) return '#d69e2e';
    if (score <= 60) return '#f97316';
    if (score <= 80) return '#ef4444';
    return '#991b1b';
  }

  if (score <= 20) return '#0ea5e9';
  if (score <= 40) return '#6366f1';
  if (score <= 60) return '#8b5cf6';
  if (score <= 80) return '#d946ef';
  return '#be123c';
}

function buildRiskPopupHtml(kind: RiskOverlayKind, properties: RiskCellProperties): string {
  const title = kind === 'weather' ? 'Weather Risk' : 'GNSS Jamming Risk';
  const updated = new Date(properties.updatedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const factors = properties.factors.length > 0
    ? properties.factors.map((factor) => `<li>${factor}</li>`).join('')
    : '<li>Sparse signal</li>';
  const staleTag = properties.stale ? ' <span class="risk-popup-content__stale">(stale)</span>' : '';
  const sourceRow = properties.source
    ? `<div class="risk-popup-content__row"><span class="label">Source</span><span>${properties.source}${staleTag}</span></div>`
    : '';
  const sampleRow = kind === 'gnss'
    ? `<div class="risk-popup-content__row"><span class="label">Sample</span><span>${properties.sampleSize} aircraft</span></div>`
    : '';

  return `<div class="risk-popup-content">
    <div class="risk-popup-content__title">${title}</div>
    <div class="risk-popup-content__row"><span class="label">Score</span><span>${properties.score}</span></div>
    <div class="risk-popup-content__row"><span class="label">Confidence</span><span>${properties.confidence}%</span></div>
    <div class="risk-popup-content__row"><span class="label">Category</span><span>${properties.category}</span></div>
    ${sourceRow}
    ${sampleRow}
    <div class="risk-popup-content__row"><span class="label">Updated</span><span>${updated}</span></div>
    <div class="risk-popup-content__factors">
      <span class="label">Factors</span>
      <ul>${factors}</ul>
    </div>
  </div>`;
}

function renderRiskOverlay(
  layerGroup: L.LayerGroup,
  kind: RiskOverlayKind,
  data: RiskFeatureCollection,
): void {
  layerGroup.clearLayers();

  const geoJsonInput = data as unknown as Parameters<typeof L.geoJSON>[0];

  L.geoJSON(geoJsonInput, {
    style: (feature) => {
      const properties = (feature as { properties?: RiskCellProperties }).properties;
      const score = properties?.score ?? 0;
      const color = overlayColor(kind, score);
      return {
        color,
        weight: 1,
        opacity: 0.95,
        fillColor: color,
        fillOpacity: 0.12 + Math.min(score / 150, 0.4),
      } satisfies L.PathOptions;
    },
    onEachFeature: (feature, layer) => {
      const properties = (feature as { properties?: RiskCellProperties }).properties;
      if (!properties) return;
      layer.bindPopup(buildRiskPopupHtml(kind, properties), {
        className: 'risk-popup',
        closeButton: false,
      });
    },
  }).addTo(layerGroup);
}

export default function FlightMap() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const markerAnimationRef = useRef<Map<string, number>>(new Map());
  const trailLayerRef = useRef<L.LayerGroup | null>(null);
  const riskLayersRef = useRef<Record<RiskOverlayKind, L.LayerGroup | null>>({ weather: null, gnss: null });
  const riskTimersRef = useRef<Record<RiskOverlayKind, number | null>>({ weather: null, gnss: null });
  const riskRequestsRef = useRef<Record<RiskOverlayKind, AbortController | null>>({ weather: null, gnss: null });
  const hasFittedRef = useRef(false);
  const riskWindowRef = useRef<RiskWindowMinutes>(15);
  const [weatherEnabled, setWeatherEnabled] = useState(false);
  const [gnssEnabled, setGnssEnabled] = useState(false);
  const [riskWindowMinutes, setRiskWindowMinutes] = useState<RiskWindowMinutes>(15);
  const [weatherLastUpdated, setWeatherLastUpdated] = useState<number | null>(null);
  const selectedFlight = useFlightStore((s: ReturnType<typeof useFlightStore.getState>) => s.selectedFlight);
  const selectFlight = useFlightStore((s: ReturnType<typeof useFlightStore.getState>) => s.selectFlight);
  const selectedFIRs = useFIRStore((s: ReturnType<typeof useFIRStore.getState>) => s.selectedFIRs);
  const flights = useVisibleFlightStore((s) => s.visibleFlights);

  useEffect(() => {
    riskWindowRef.current = riskWindowMinutes;
  }, [riskWindowMinutes]);

  const cancelMarkerAnimation = useCallback((icao24: string) => {
    const frame = markerAnimationRef.current.get(icao24);
    if (frame) {
      cancelAnimationFrame(frame);
      markerAnimationRef.current.delete(icao24);
    }
  }, []);

  const animateMarkerPosition = useCallback(
    (icao24: string, marker: L.Marker, latitude: number, longitude: number) => {
      cancelMarkerAnimation(icao24);

      const start = marker.getLatLng();
      const deltaLat = latitude - start.lat;
      const deltaLng = longitude - start.lng;

      if (Math.abs(deltaLat) < 0.0001 && Math.abs(deltaLng) < 0.0001) {
        marker.setLatLng([latitude, longitude]);
        return;
      }

      const startTime = performance.now();
      const duration = 1200;

      const step = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1);
        marker.setLatLng([
          start.lat + deltaLat * progress,
          start.lng + deltaLng * progress,
        ]);

        if (progress < 1) {
          const frame = requestAnimationFrame(step);
          markerAnimationRef.current.set(icao24, frame);
        } else {
          markerAnimationRef.current.delete(icao24);
        }
      };

      const frame = requestAnimationFrame(step);
      markerAnimationRef.current.set(icao24, frame);
    },
    [cancelMarkerAnimation],
  );

  const clearRiskLayer = useCallback((kind: RiskOverlayKind) => {
    const timer = riskTimersRef.current[kind];
    if (timer !== null) {
      window.clearTimeout(timer);
      riskTimersRef.current[kind] = null;
    }

    riskRequestsRef.current[kind]?.abort();
    riskRequestsRef.current[kind] = null;
    riskLayersRef.current[kind]?.clearLayers();

    if (kind === 'weather') {
      setWeatherLastUpdated(null);
    }
  }, []);

  const fetchRiskLayer = useCallback(async (kind: RiskOverlayKind) => {
    const map = mapRef.current;
    const layerGroup = riskLayersRef.current[kind];
    if (!map || !layerGroup) return;

    const bounds = map.getBounds();
    const bbox = [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()].join(',');
    const endpoint = kind === 'weather' ? '/api/layers/weather-risk' : '/api/layers/gnss-jamming-risk';

    riskRequestsRef.current[kind]?.abort();
    const controller = new AbortController();
    riskRequestsRef.current[kind] = controller;

    try {
      const params = kind === 'weather'
        ? `bbox=${encodeURIComponent(bbox)}&z=${map.getZoom()}`
        : `bbox=${encodeURIComponent(bbox)}&z=${map.getZoom()}&minutes=${riskWindowRef.current}`;

      const response = await fetch(`${endpoint}?${params}`, { signal: controller.signal });
      if (!response.ok) {
        clearRiskLayer(kind);
        return;
      }

      const data = (await response.json()) as RiskFeatureCollection;
      if (controller.signal.aborted) return;

      renderRiskOverlay(layerGroup, kind, data);

      if (kind === 'weather') {
        const latestUpdated = data.features.reduce(
          (latest, feature) => Math.max(latest, feature.properties.updatedAt),
          0,
        );
        setWeatherLastUpdated(latestUpdated || Date.now());
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        clearRiskLayer(kind);
      }
    } finally {
      if (riskRequestsRef.current[kind] === controller) {
        riskRequestsRef.current[kind] = null;
      }
    }
  }, [clearRiskLayer]);

  const scheduleRiskFetch = useCallback((kind: RiskOverlayKind) => {
    const existing = riskTimersRef.current[kind];
    if (existing !== null) {
      window.clearTimeout(existing);
    }

    riskTimersRef.current[kind] = window.setTimeout(() => {
      riskTimersRef.current[kind] = null;
      void fetchRiskLayer(kind);
    }, 180);
  }, [fetchRiskLayer]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const riskLayers = riskLayersRef.current;
    const markerAnimations = markerAnimationRef.current;

    const map = L.map(containerRef.current, {
      center: MAP_CENTER,
      zoom: 5,
      preferCanvas: true,
      zoomControl: false,
      attributionControl: false,
    });

    const attributionControl = L.control.attribution({ position: 'bottomleft', prefix: false });
    attributionControl.addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);

    const baseLayers = createBaseLayerConfigs();
    const baseLayerInstances = Object.fromEntries(
      baseLayers.map((config) => [
        config.name,
        L.tileLayer(config.url, {
          attribution: config.attribution,
          ...config.options,
        }),
      ]),
    ) as Record<string, L.TileLayer>;

    const defaultBaseLayer = baseLayers.find((config) => !config.aeronautical) ?? baseLayers[0];
    const weatherLayer = L.layerGroup();
    const gnssLayer = L.layerGroup();
    riskLayers.weather = weatherLayer;
    riskLayers.gnss = gnssLayer;

    baseLayerInstances[defaultBaseLayer.name].addTo(map);
    const layerControl = L.control.layers(
      baseLayerInstances,
      {
        [OVERLAY_LABELS.weather]: weatherLayer,
        [OVERLAY_LABELS.gnss]: gnssLayer,
      },
      { position: 'topright', collapsed: false },
    ).addTo(map);

    const handleOverlayAdd = (event: L.LayersControlEvent) => {
      if (event.layer === weatherLayer) {
        setWeatherEnabled(true);
      }
      if (event.layer === gnssLayer) {
        setGnssEnabled(true);
      }
    };

    const handleOverlayRemove = (event: L.LayersControlEvent) => {
      if (event.layer === weatherLayer) {
        setWeatherEnabled(false);
      }
      if (event.layer === gnssLayer) {
        setGnssEnabled(false);
      }
    };

    map.on('overlayadd', handleOverlayAdd);
    map.on('overlayremove', handleOverlayRemove);

    trailLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setMapInstance(map);

    return () => {
      map.off('overlayadd', handleOverlayAdd);
      map.off('overlayremove', handleOverlayRemove);
      layerControl.remove();
      clearRiskLayer('weather');
      clearRiskLayer('gnss');
      riskLayers.weather = null;
      riskLayers.gnss = null;
      for (const frame of markerAnimations.values()) {
        cancelAnimationFrame(frame);
      }
      markerAnimations.clear();
      setMapInstance(null);
      map.remove();
      mapRef.current = null;
    };
  }, [clearRiskLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || selectedFIRs.length === 0) return;
    if (hasFittedRef.current) return;

    let minLat = 90;
    let maxLat = -90;
    let minLng = 180;
    let maxLng = -180;
    let hasBounds = false;

    for (const firId of selectedFIRs) {
      const bounds = getFIRBounds(firId);
      if (!bounds) continue;
      hasBounds = true;
      if (bounds.minLat < minLat) minLat = bounds.minLat;
      if (bounds.maxLat > maxLat) maxLat = bounds.maxLat;
      if (bounds.minLng < minLng) minLng = bounds.minLng;
      if (bounds.maxLng > maxLng) maxLng = bounds.maxLng;
    }

    if (hasBounds) {
      map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [40, 40] });
      hasFittedRef.current = true;
    }
  }, [selectedFIRs]);

  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set<string>();

    for (const flight of flights) {
      currentIds.add(flight.icao24);
      const color = flightTypeColor(flight.type);
      const isSelected = flight.icao24 === selectedFlight;

      let marker = markersRef.current.get(flight.icao24);
      const icon = getAircraftIcon(color, flight.heading, isSelected);

      if (marker) {
        if (flights.length <= 750) {
          animateMarkerPosition(flight.icao24, marker, flight.latitude, flight.longitude);
        } else {
          cancelMarkerAnimation(flight.icao24);
          marker.setLatLng([flight.latitude, flight.longitude]);
        }
        marker.setIcon(icon);
      } else {
        marker = L.marker([flight.latitude, flight.longitude], { icon });
        marker.on('click', () => {
          selectFlight(flight.icao24);
        });
        marker.addTo(map);
        markersRef.current.set(flight.icao24, marker);
      }

      const existingPopup = marker.getPopup();
      if (existingPopup && existingPopup.isOpen()) {
        existingPopup.setContent(buildPopupHtml(flight));
      } else if (!existingPopup) {
        marker.bindPopup(() => buildPopupHtml(flight), { className: 'flight-popup', closeButton: false });
      }
    }

    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        cancelMarkerAnimation(id);
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [flights, selectedFlight, selectFlight, animateMarkerPosition, cancelMarkerAnimation]);

  useEffect(() => {
    updateMarkers();
  }, [updateMarkers]);

  useEffect(() => {
    if (weatherEnabled) {
      scheduleRiskFetch('weather');
      const interval = window.setInterval(() => {
        scheduleRiskFetch('weather');
      }, 5 * 60_000);

      return () => {
        window.clearInterval(interval);
      };
    }

    clearRiskLayer('weather');
    return undefined;
  }, [weatherEnabled, scheduleRiskFetch, clearRiskLayer]);

  useEffect(() => {
    if (gnssEnabled) {
      scheduleRiskFetch('gnss');
      return;
    }

    clearRiskLayer('gnss');
  }, [gnssEnabled, riskWindowMinutes, scheduleRiskFetch, clearRiskLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const refreshActiveLayers = () => {
      if (weatherEnabled) scheduleRiskFetch('weather');
      if (gnssEnabled) scheduleRiskFetch('gnss');
    };

    map.on('moveend', refreshActiveLayers);
    map.on('zoomend', refreshActiveLayers);

    return () => {
      map.off('moveend', refreshActiveLayers);
      map.off('zoomend', refreshActiveLayers);
    };
  }, [weatherEnabled, gnssEnabled, scheduleRiskFetch]);

  useEffect(() => {
    const trailLayer = trailLayerRef.current;
    if (!trailLayer) return;
    trailLayer.clearLayers();

    if (!selectedFlight) return;

    const flight = flights.find((entry) => entry.icao24 === selectedFlight);
    if (!flight || flight.trail.length < 2) return;

    const latlngs = flight.trail.map((point) => [point.lat, point.lon] as L.LatLngExpression);
    L.polyline(latlngs, {
      color: flightTypeColor(flight.type),
      weight: 2,
      opacity: 0.7,
      dashArray: '6, 4',
      className: 'flight-trail',
    }).addTo(trailLayer);
  }, [selectedFlight, flights]);

  return (
    <>
      <div ref={containerRef} className="map-container" />
      <FIRDiagnostics />
      <OverlayLegend
        weatherEnabled={weatherEnabled}
        gnssEnabled={gnssEnabled}
        weatherLastUpdated={weatherLastUpdated}
        minutes={riskWindowMinutes}
        onMinutesChange={(minutes) => setRiskWindowMinutes(minutes as RiskWindowMinutes)}
      />
    </>
  );
}
