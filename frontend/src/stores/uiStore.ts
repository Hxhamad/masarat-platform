import { create } from 'zustand';

type Theme = 'dark' | 'light';

const THEME_KEY = 'masarat_theme';
const LAYOUT_KEY = 'masarat_layout';

function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch { /* ignore */ }
  return 'dark';
}

interface LayoutState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftSize: number;   // percentage
  rightSize: number;  // percentage
}

function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        leftCollapsed: !!parsed.leftCollapsed,
        rightCollapsed: parsed.rightCollapsed ?? true,
        leftSize: typeof parsed.leftSize === 'number' ? parsed.leftSize : 20,
        rightSize: typeof parsed.rightSize === 'number' ? parsed.rightSize : 22,
      };
    }
  } catch { /* ignore */ }
  return { leftCollapsed: false, rightCollapsed: true, leftSize: 20, rightSize: 22 };
}

function persistLayout(layout: Partial<LayoutState>) {
  try {
    const current = loadLayout();
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...current, ...layout }));
  } catch { /* ignore */ }
}

const initialTheme = loadTheme();
const initialLayout = loadLayout();
document.documentElement.setAttribute('data-theme', initialTheme);

interface UIState {
  theme: Theme;
  infoPanelOpen: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftSize: number;
  rightSize: number;

  toggleTheme: () => void;
  setInfoPanelOpen: (open: boolean) => void;
  setLeftCollapsed: (collapsed: boolean) => void;
  setRightCollapsed: (collapsed: boolean) => void;
  setLeftSize: (size: number) => void;
  setRightSize: (size: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: initialTheme,
  infoPanelOpen: false,
  leftCollapsed: initialLayout.leftCollapsed,
  rightCollapsed: initialLayout.rightCollapsed,
  leftSize: initialLayout.leftSize,
  rightSize: initialLayout.rightSize,

  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      return { theme: next };
    }),

  setInfoPanelOpen: (infoPanelOpen) => set({ infoPanelOpen }),

  setLeftCollapsed: (leftCollapsed) => {
    persistLayout({ leftCollapsed });
    set({ leftCollapsed });
  },

  setRightCollapsed: (rightCollapsed) => {
    persistLayout({ rightCollapsed });
    set({ rightCollapsed });
  },

  setLeftSize: (leftSize) => {
    persistLayout({ leftSize });
    set({ leftSize });
  },

  setRightSize: (rightSize) => {
    persistLayout({ rightSize });
    set({ rightSize });
  },
}));
