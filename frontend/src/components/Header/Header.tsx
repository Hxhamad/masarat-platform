import { Search, Sun, Moon, Radar, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useFilterStore } from '../../stores/filterStore';
import { useUIStore } from '../../stores/uiStore';
import './Header.css';

interface HeaderProps {
  leftCollapsed?: boolean;
  onToggleLeft?: () => void;
}

export default function Header({ leftCollapsed, onToggleLeft }: HeaderProps) {
  const { searchQuery, setSearchQuery } = useFilterStore();
  const { theme, toggleTheme } = useUIStore();

  return (
    <header className="header">
      <div className="header__brand">
        {onToggleLeft && (
          <button className="header__btn" onClick={onToggleLeft} aria-label={leftCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
            {leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
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
            aria-label="Search by callsign, ICAO code, or registration"
            placeholder="Search callsign, ICAO, reg..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <button className="header__btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}
