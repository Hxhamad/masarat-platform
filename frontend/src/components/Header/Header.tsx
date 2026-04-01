import { Search, Sun, Moon, Radar } from 'lucide-react';
import { useFilterStore } from '../../stores/filterStore';
import { useUIStore } from '../../stores/uiStore';
import './Header.css';

export default function Header() {
  const { searchQuery, setSearchQuery } = useFilterStore();
  const { theme, toggleTheme } = useUIStore();

  return (
    <header className="header">
      <div className="header__brand">
        <Radar size={20} color="var(--accent)" />
        <span className="header__logo">MASARAT</span>
        <div className="header__divider" />
        <span className="header__subtitle">ADS-B Monitor</span>
      </div>

      <div className="header__actions">
        <div className="header__search">
          <Search size={14} className="header__search-icon" />
          <input
            className="header__search-input"
            type="text"
            placeholder="Search callsign, ICAO, reg..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <button className="header__btn" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}
