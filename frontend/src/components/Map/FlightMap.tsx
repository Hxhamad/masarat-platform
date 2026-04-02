import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Map.css';
import type { ADSBFlight } from '../../types/flight';
import { useFlightStore } from '../../stores/flightStore';
import { useFilteredFlights } from '../../hooks/useFilteredFlights';
import { useFIRFilter } from '../../hooks/useFIRFilter';
import { flightTypeColor, formatAltitude, formatSpeed, displayCallsign } from '../../lib/utils';
import { setMapInstance } from './mapRef';

// SVG aircraft icon factory
function createAircraftSvg(color: string, heading: number, selected: boolean): string {
  return `<div class="aircraft-icon ${selected ? 'aircraft-icon--selected' : ''}" style="transform: rotate(${heading}deg)">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L8 10H3L5 13H8L10 20H14L16 13H19L21 10H16L12 2Z"/>
    </svg>
  </div>`;
}

const MAP_CENTER: L.LatLngExpression = [50, 10]; // Europe

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

export default function FlightMap() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const trailLayerRef = useRef<L.LayerGroup | null>(null);

  const filteredFlights = useFilteredFlights();
  const flights = useFIRFilter(filteredFlights);
  const selectedFlight = useFlightStore((s) => s.selectedFlight);
  const selectFlight = useFlightStore((s) => s.selectFlight);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: MAP_CENTER,
      zoom: 5,
      preferCanvas: true,
      zoomControl: false,
      attributionControl: false,
    });

    // Add zoom control to top-right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Dark tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      subdomains: 'abcd',
    }).addTo(map);

    // Attribution (required but minimal)
    L.control.attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('&copy; <a href="https://carto.com">CARTO</a>')
      .addTo(map);

    trailLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setMapInstance(map);

    return () => {
      setMapInstance(null);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers
  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set<string>();

    for (const flight of flights) {
      currentIds.add(flight.icao24);
      const color = flightTypeColor(flight.type);
      const isSelected = flight.icao24 === selectedFlight;

      let marker = markersRef.current.get(flight.icao24);
      if (marker) {
        // Update position
        marker.setLatLng([flight.latitude, flight.longitude]);
        // Update icon
        marker.setIcon(L.divIcon({
          html: createAircraftSvg(color, flight.heading, isSelected),
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          className: '',
        }));
      } else {
        // Create new marker
        marker = L.marker([flight.latitude, flight.longitude], {
          icon: L.divIcon({
            html: createAircraftSvg(color, flight.heading, isSelected),
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            className: '',
          }),
        });

        marker.on('click', () => {
          selectFlight(flight.icao24);
        });

        marker.addTo(map);
        markersRef.current.set(flight.icao24, marker);
      }

      // Popup — update content live if open
      const popupHtml = buildPopupHtml(flight);
      const existingPopup = marker.getPopup();
      if (existingPopup) {
        existingPopup.setContent(popupHtml);
      } else {
        marker.bindPopup(popupHtml, { className: 'flight-popup', closeButton: false });
      }
    }

    // Remove stale markers
    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [flights, selectedFlight, selectFlight]);

  useEffect(() => {
    updateMarkers();
  }, [updateMarkers]);

  // Draw trail for selected flight
  useEffect(() => {
    const trailLayer = trailLayerRef.current;
    if (!trailLayer) return;
    trailLayer.clearLayers();

    if (!selectedFlight) return;

    const flight = flights.find((f) => f.icao24 === selectedFlight);
    if (!flight || flight.trail.length < 2) return;

    const latlngs = flight.trail.map((t) => [t.lat, t.lon] as L.LatLngExpression);
    L.polyline(latlngs, {
      color: flightTypeColor(flight.type),
      weight: 2,
      opacity: 0.7,
      dashArray: '6, 4',
      className: 'flight-trail',
    }).addTo(trailLayer);
  }, [selectedFlight, flights]);

  return <div ref={containerRef} className="map-container" />;
}
