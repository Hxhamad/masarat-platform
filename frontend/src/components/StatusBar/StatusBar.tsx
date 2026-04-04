import { useState, useEffect } from 'react';
import { useFlightStore } from '../../stores/flightStore';
import { useFIRStore } from '../../stores/firStore';
import './StatusBar.css';

const STALE_THRESHOLD = 30_000; // 30s without a message = stale

export default function StatusBar() {
  const { stats, connectionStatus, flights, lastMessageAt } = useFlightStore();
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);

  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      if (lastMessageAt > 0 && Date.now() - lastMessageAt > STALE_THRESHOLD) {
        setIsStale(true);
      } else {
        setIsStale(false);
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [lastMessageAt]);

  const dotClass = isStale && connectionStatus === 'connected'
    ? 'status-bar__dot status-bar__dot--stale'
    : `status-bar__dot status-bar__dot--${connectionStatus}`;

  const statusLabel = isStale && connectionStatus === 'connected'
    ? 'stale'
    : connectionStatus;

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <div className="status-bar__item">
          <span className={dotClass} />
          <span>{statusLabel}</span>
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
