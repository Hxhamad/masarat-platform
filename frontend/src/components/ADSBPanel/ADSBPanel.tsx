import { useFilteredFlights } from '../../hooks/useFilteredFlights';
import { useFlightStore } from '../../stores/flightStore';
import { useUIStore } from '../../stores/uiStore';
import { flightTypeColor, formatAltitude, displayCallsign } from '../../lib/utils';
import './ADSBPanel.css';

export default function ADSBPanel() {
  const flights = useFilteredFlights();
  const { selectedFlight, selectFlight } = useFlightStore();
  const { setInfoPanelOpen } = useUIStore();

  const handleSelect = (icao24: string) => {
    selectFlight(icao24);
    setInfoPanelOpen(true);
  };

  // Sort: selected first, then by callsign
  const sorted = [...flights].sort((a, b) => {
    if (a.icao24 === selectedFlight) return -1;
    if (b.icao24 === selectedFlight) return 1;
    return displayCallsign(a).localeCompare(displayCallsign(b));
  });

  // Limit displayed items for performance
  const display = sorted.slice(0, 200);

  return (
    <div className="adsb-panel">
      <div className="adsb-panel__header">
        Nearby — {flights.length} aircraft
      </div>
      <div className="adsb-panel__list">
        {display.length === 0 ? (
          <div className="adsb-panel__empty">No aircraft match filters</div>
        ) : (
          display.map((f) => (
            <div
              key={f.icao24}
              className={`adsb-panel__item ${f.icao24 === selectedFlight ? 'adsb-panel__item--selected' : ''}`}
              onClick={() => handleSelect(f.icao24)}
            >
              <span
                className="adsb-panel__type-dot"
                style={{ background: flightTypeColor(f.type) }}
              />
              <span className="adsb-panel__callsign">{displayCallsign(f)}</span>
              <span className="adsb-panel__meta">
                {formatAltitude(f.altitude)}
                <br />
                {f.aircraftType || f.icao24.toUpperCase()}
                <br />
                <span className="adsb-panel__coords">{f.latitude.toFixed(2)}° {f.longitude.toFixed(2)}°</span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
