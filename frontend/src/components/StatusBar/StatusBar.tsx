import { useFlightStore } from '../../stores/flightStore';
import './StatusBar.css';

export default function StatusBar() {
  const { stats, connectionStatus, flights } = useFlightStore();

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
