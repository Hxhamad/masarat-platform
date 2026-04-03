import { useMemo } from 'react';
import { useFilteredFlights } from '../../hooks/useFilteredFlights';
import { useFIRFilter } from '../../hooks/useFIRFilter';
import { useFlightStore } from '../../stores/flightStore';
import { useUIStore } from '../../stores/uiStore';
import { useFIRStore } from '../../stores/firStore';
import { useHealthStore } from '../../stores/healthStore';
import { getFIRList } from '../../lib/firService';
import { flightTypeColor, formatAltitude, displayCallsign } from '../../lib/utils';
import FIRPanel from './FIRPanel';
import ViewTabs from '../ViewTabs/ViewTabs';
import HealthPanel from '../HealthPanel/HealthPanel';
import Leaderboard from '../Leaderboard/Leaderboard';
import './ADSBPanel.css';

export default function ADSBPanel() {
  const filteredFlights = useFilteredFlights();
  const flights = useFIRFilter(filteredFlights);
  const { selectedFlight, selectFlight } = useFlightStore();
  const { setInfoPanelOpen } = useUIStore();
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const viewMode = useHealthStore((s) => s.viewMode);

  const handleSelect = (icao24: string) => {
    selectFlight(icao24);
    setInfoPanelOpen(true);
  };

  // Build the FIR header label
  const firLabel = useMemo(() => {
    const firList = getFIRList();
    const names = selectedFIRs.map((id) => {
      const f = firList.find((fir) => fir.id === id);
      return f?.id ?? id;
    });
    return names.join(' · ');
  }, [selectedFIRs]);

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
      <FIRPanel />
      <ViewTabs />
      {viewMode === 'flights' && (
        <>
          <div className="adsb-panel__header">
            <span className="adsb-panel__fir-label">{firLabel}</span>
            <span className="adsb-panel__count">{flights.length} aircraft</span>
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
        </>
      )}
      {viewMode === 'health' && <HealthPanel />}
      {viewMode === 'leaderboard' && <Leaderboard />}
    </div>
  );
}
