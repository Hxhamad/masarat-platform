/**
 * FIRPanel — FIR management UI embedded in the ADS-B sidebar.
 *
 * Shows selected FIRs with ability to manage them.
 * FIR filtering is always active — no toggle.
 */

import { MapPin, X, Layers, Settings } from 'lucide-react';
import { useFIRStore } from '../../stores/firStore';
import { getFIRList } from '../../lib/firService';
import './FIRPanel.css';

export default function FIRPanel() {
  const {
    selectedFIRs,
    removeFIR,
    reopenFIRSetup,
  } = useFIRStore();

  return (
    <div className="fir-panel">
      <div className="fir-panel__header">
        <Layers size={14} />
        <span>Monitored FIRs</span>
        <button className="fir-panel__manage-btn" onClick={reopenFIRSetup} title="Change FIRs">
          <Settings size={14} />
        </button>
      </div>

      <div className="fir-panel__body">
        {/* Selected FIR chips */}
        {selectedFIRs.length > 0 && (
          <div className="fir-panel__chips">
            {selectedFIRs.map((id) => {
              const fir = getFIRList().find((f) => f.id === id);
              return (
                <span key={id} className="fir-panel__chip">
                  <MapPin size={10} className="fir-panel__chip-icon" />
                  <span className="fir-panel__chip-text">
                    {fir ? `${fir.id}` : id}
                  </span>
                  {selectedFIRs.length > 1 && (
                    <button
                      className="fir-panel__chip-remove"
                      onClick={() => removeFIR(id)}
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
