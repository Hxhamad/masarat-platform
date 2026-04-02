/**
 * FIRPanel — FIR selection UI embedded in the ADS-B sidebar.
 *
 * - Toggle FIR layer on/off
 * - Search FIRs by name / ICAO code / country
 * - Select up to 6 FIRs with visual chips
 */

import { useEffect, useMemo, useCallback } from 'react';
import { MapPin, X, Layers, Search } from 'lucide-react';
import { useFIRStore } from '../../stores/firStore';
import { getFIRList } from '../../lib/firService';
import './FIRPanel.css';

const MAX_DISPLAY = 50; // Limit dropdown to prevent DOM bloat

export default function FIRPanel() {
  const {
    loading,
    firLayerEnabled,
    selectedFIRs,
    firSearchQuery,
    loadFIRs,
    toggleFIR,
    removeFIR,
    clearFIRs,
    setFIRLayerEnabled,
    setFIRSearchQuery,
  } = useFIRStore();

  // Load FIR data on first enable
  useEffect(() => {
    if (firLayerEnabled) {
      loadFIRs();
    }
  }, [firLayerEnabled, loadFIRs]);

  // Filter the FIR list for the search dropdown
  const firOptions = useMemo(() => {
    if (!firLayerEnabled) return [];
    const all = getFIRList();
    if (!firSearchQuery.trim()) return all.slice(0, MAX_DISPLAY);

    const q = firSearchQuery.toLowerCase();
    return all
      .filter(
        (f) =>
          f.id.toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q) ||
          f.country.toLowerCase().includes(q),
      )
      .slice(0, MAX_DISPLAY);
  }, [firLayerEnabled, firSearchQuery]);

  const handleToggleLayer = useCallback(() => {
    setFIRLayerEnabled(!firLayerEnabled);
  }, [firLayerEnabled, setFIRLayerEnabled]);

  const selectedSet = useMemo(() => new Set(selectedFIRs), [selectedFIRs]);

  return (
    <div className="fir-panel">
      <div className="fir-panel__header">
        <Layers size={14} />
        <span>FIR Boundaries</span>
        <label className="fir-panel__toggle">
          <input
            type="checkbox"
            checked={firLayerEnabled}
            onChange={handleToggleLayer}
          />
          <span className="fir-panel__toggle-slider" />
        </label>
      </div>

      {firLayerEnabled && (
        <div className="fir-panel__body">
          {/* Selected FIR chips */}
          {selectedFIRs.length > 0 && (
            <div className="fir-panel__chips">
              {selectedFIRs.map((id) => {
                const fir = getFIRList().find((f) => f.id === id);
                return (
                  <span key={id} className="fir-panel__chip">
                    <span className="fir-panel__chip-text">
                      {fir?.id ?? id}
                    </span>
                    <button
                      className="fir-panel__chip-remove"
                      onClick={() => removeFIR(id)}
                    >
                      <X size={10} />
                    </button>
                  </span>
                );
              })}
              {selectedFIRs.length > 1 && (
                <button className="fir-panel__clear" onClick={clearFIRs}>
                  Clear all
                </button>
              )}
            </div>
          )}

          {/* Search input */}
          <div className="fir-panel__search">
            <Search size={12} className="fir-panel__search-icon" />
            <input
              className="fir-panel__search-input"
              type="text"
              placeholder="Search FIR (OEJD, Jeddah, ...)"
              value={firSearchQuery}
              onChange={(e) => setFIRSearchQuery(e.target.value)}
            />
          </div>

          {/* Status */}
          {loading && <div className="fir-panel__status">Loading FIR data...</div>}
          {selectedFIRs.length >= 6 && (
            <div className="fir-panel__status fir-panel__status--warn">
              Maximum 6 FIRs selected
            </div>
          )}

          {/* FIR list */}
          <div className="fir-panel__list">
            {firOptions.map((f) => {
              const isSelected = selectedSet.has(f.id);
              return (
                <div
                  key={f.id}
                  className={`fir-panel__item ${isSelected ? 'fir-panel__item--selected' : ''}`}
                  onClick={() => toggleFIR(f.id)}
                >
                  <MapPin
                    size={12}
                    className={`fir-panel__item-icon ${isSelected ? 'fir-panel__item-icon--active' : ''}`}
                  />
                  <div className="fir-panel__item-info">
                    <span className="fir-panel__item-name">{f.name}</span>
                    <span className="fir-panel__item-meta">
                      {f.id} {f.country ? `· ${f.country}` : ''}
                    </span>
                  </div>
                </div>
              );
            })}
            {!loading && firOptions.length === 0 && (
              <div className="fir-panel__empty">No FIRs found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
