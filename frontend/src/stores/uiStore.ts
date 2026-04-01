import { create } from 'zustand';

type Theme = 'dark' | 'light';

interface UIState {
  theme: Theme;
  infoPanelOpen: boolean;

  toggleTheme: () => void;
  setInfoPanelOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
  infoPanelOpen: false,

  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      return { theme: next };
    }),

  setInfoPanelOpen: (infoPanelOpen) => set({ infoPanelOpen }),
}));
