import { useEffect, useMemo } from 'react';
import { useVisibleFlightStore } from '../../stores/visibleFlightStore';
import { useFilterStore } from '../../stores/filterStore';
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
  const flights = useVisibleFlightStore((s) => s.visibleFlights);
  const aircraftScope = useFilterStore((s) => s.aircraftScope);
  const { selectedFlight, selectFlight } = useFlightStore();
  const { setInfoPanelOpen } = useUIStore();
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const viewMode = useHealthStore((s) => s.viewMode);
  const setViewMode = useHealthStore((s) => s.setViewMode);

  const handleSelect = (icao24: string) => {
    selectFlight(icao24);
    setInfoPanelOpen(true);
  };

  useEffect(() => {
    if (aircraftScope === 'all' && viewMode !== 'flights') {
      setViewMode('flights');
    }
  }, [aircraftScope, viewMode, setViewMode]);

  // Build the FIR header label
  const firLabel = useMemo(() => {
    const firList = getFIRList();
    const names = selectedFIRs.map((id) => {
      const f = firList.find((fir) => fir.id === id);
      return f?.id ?? id;
    });
    return names.join(' · ');
  }, [selectedFIRs]);

  const effectiveViewMode = aircraftScope === 'all' ? 'flights' : viewMode;
  const headerLabel = aircraftScope === 'all' ? 'All Aircraft' : firLabel;

  const display = useMemo(() => {
    const sorted = [...flights].sort((a, b) => {
      if (a.icao24 === selectedFlight) return -1;
      if (b.icao24 === selectedFlight) return 1;
      return displayCallsign(a).localeCompare(displayCallsign(b));
    });

    return sorted.slice(0, 200);
  }, [flights, selectedFlight]);

  return (
    <div className="adsb-panel">
      <FIRPanel />
      <ViewTabs />
      {effectiveViewMode === 'flights' && (
        <>
          <div className="adsb-panel__header">
            <span className="adsb-panel__fir-label">{headerLabel}</span>
            <span className="adsb-panel__count">{flights.length} visible</span>
          </div>
          <div className="adsb-panel__list" role="listbox" aria-label="Aircraft list">
            {display.length === 0 ? (
              <div className="adsb-panel__empty">No aircraft match filters</div>
            ) : (
              display.map((f) => (
                <div
                  key={f.icao24}
                  role="option"
                  tabIndex={0}
                  aria-selected={f.icao24 === selectedFlight}
                  className={`adsb-panel__item ${f.icao24 === selectedFlight ? 'adsb-panel__item--selected' : ''}`}
                  onClick={() => handleSelect(f.icao24)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(f.icao24);
                    }
                  }}
                >
                  <span
                    className="adsb-panel__type-dot"
                    style={{ background: flightTypeColor(f.type) }}
                    aria-label={`Type: ${f.type || 'unknown'}`}
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
      {effectiveViewMode === 'health' && <HealthPanel />}
      {effectiveViewMode === 'leaderboard' && <Leaderboard />}
    </div>
  );
}
