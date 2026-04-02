import { useFlightStore } from '../../stores/flightStore';
import { useFIRStore } from '../../stores/firStore';
import './StatusBar.css';

export default function StatusBar() {
  const { stats, connectionStatus, flights } = useFlightStore();
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <div className="status-bar__item">
          <span className={`status-bar__dot status-bar__dot--${connectionStatus}`} />
          <span>{connectionStatus}</span>
        </div>
        <div className="status-bar__item">
          <span className="status-bar__source">{stats.dataSource}</span>
        </div>
        {selectedFIRs.length > 0 && (
          <div className="status-bar__item">
            <span className="status-bar__fir-badge">FIR</span>
            <span className="status-bar__fir-codes">{selectedFIRs.join(' · ')}</span>
          </div>
        )}
      </div>

      <div className="status-bar__right">
        <div className="status-bar__item">
          <span>{flights.size} aircraft</span>
        </div>
        <div className="status-bar__item">
          <span>{stats.messagesPerSecond} msg/s</span>
        </div>
        <div className="status-bar__item">
          <span>{stats.lastUpdate ? new Date(stats.lastUpdate).toLocaleTimeString() : '--:--:--'}</span>
        </div>
      </div>
    </div>
  );
}
