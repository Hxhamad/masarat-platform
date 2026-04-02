/**
 * FIRSelectionModal — Startup modal that requires user to select 1–6 FIRs
 * before the main app is shown. Control Tower themed.
 */

import { useEffect, useMemo, useState } from 'react';
import { Radar, MapPin, Search, X } from 'lucide-react';
import { useFIRStore } from '../../stores/firStore';
import { getFIRList } from '../../lib/firService';
import './FIRSelectionModal.css';

const MAX_DISPLAY = 80;

export default function FIRSelectionModal() {
  const {
    loading,
    selectedFIRs,
    firSearchQuery,
    loadFIRs,
    toggleFIR,
    removeFIR,
    setFIRSearchQuery,
    completeFIRSetup,
  } = useFIRStore();

  const [searchFocused, setSearchFocused] = useState(false);

  // Load FIR data immediately
  useEffect(() => {
    loadFIRs();
  }, [loadFIRs]);

  // Filter the FIR list
  const firOptions = useMemo(() => {
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
  }, [firSearchQuery]);

  const selectedSet = useMemo(() => new Set(selectedFIRs), [selectedFIRs]);

  const canStart = selectedFIRs.length > 0;

  const handleStart = () => {
    if (canStart) {
      completeFIRSetup();
    }
  };

  return (
    <div className="fir-modal-overlay">
      <div className="fir-modal">
        {/* Header */}
        <div className="fir-modal__header">
          <Radar size={28} className="fir-modal__logo-icon" />
          <div className="fir-modal__title-block">
            <h1 className="fir-modal__title">MASARAT</h1>
            <p className="fir-modal__subtitle">ADS-B Aviation Monitor</p>
          </div>
        </div>

        <div className="fir-modal__divider" />

        {/* Prompt */}
        <p className="fir-modal__prompt">
          Select the Flight Information Regions you want to monitor.
          <br />
          <span className="fir-modal__prompt-hint">Choose 1 to 6 FIRs to begin tracking aircraft.</span>
        </p>

        {/* Selected FIR chips */}
        {selectedFIRs.length > 0 && (
          <div className="fir-modal__chips">
            {selectedFIRs.map((id) => {
              const fir = getFIRList().find((f) => f.id === id);
              return (
                <span key={id} className="fir-modal__chip">
                  <span className="fir-modal__chip-text">
                    {fir ? `${fir.id} — ${fir.name}` : id}
                  </span>
                  <button className="fir-modal__chip-remove" onClick={() => removeFIR(id)}>
                    <X size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Counter */}
        <div className={`fir-modal__counter ${selectedFIRs.length >= 6 ? 'fir-modal__counter--max' : ''}`}>
          {selectedFIRs.length} / 6 FIRs selected
        </div>

        {/* Search */}
        <div className={`fir-modal__search ${searchFocused ? 'fir-modal__search--focused' : ''}`}>
          <Search size={16} className="fir-modal__search-icon" />
          <input
            className="fir-modal__search-input"
            type="text"
            placeholder="Search by name, ICAO code, or country..."
            value={firSearchQuery}
            onChange={(e) => setFIRSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
        </div>

        {/* Loading state */}
        {loading && (
          <div className="fir-modal__loading">
            <div className="fir-modal__spinner" />
            <span>Loading FIR boundaries...</span>
          </div>
        )}

        {/* FIR list */}
        {!loading && (
          <div className="fir-modal__list">
            {firOptions.map((f) => {
              const isSelected = selectedSet.has(f.id);
              const isDisabled = !isSelected && selectedFIRs.length >= 6;
              return (
                <div
                  key={f.id}
                  className={`fir-modal__item ${isSelected ? 'fir-modal__item--selected' : ''} ${isDisabled ? 'fir-modal__item--disabled' : ''}`}
                  onClick={() => !isDisabled && toggleFIR(f.id)}
                >
                  <MapPin
                    size={16}
                    className={`fir-modal__item-icon ${isSelected ? 'fir-modal__item-icon--active' : ''}`}
                  />
                  <div className="fir-modal__item-info">
                    <span className="fir-modal__item-name">{f.name}</span>
                    <span className="fir-modal__item-meta">
                      {f.id} {f.country ? `· ${f.country}` : ''}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="fir-modal__item-check">&#10003;</span>
                  )}
                </div>
              );
            })}
            {!loading && firOptions.length === 0 && (
              <div className="fir-modal__empty">No FIRs found matching your search</div>
            )}
          </div>
        )}

        {/* Start button */}
        <button
          className={`fir-modal__start ${canStart ? 'fir-modal__start--active' : ''}`}
          onClick={handleStart}
          disabled={!canStart}
        >
          {canStart
            ? `Start Monitoring ${selectedFIRs.length} FIR${selectedFIRs.length > 1 ? 's' : ''}`
            : 'Select at least 1 FIR to continue'}
        </button>
      </div>
    </div>
  );
}
