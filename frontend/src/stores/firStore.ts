import { create } from 'zustand';
import type { FIRFeature } from '../types/fir';
import { fetchFIRFeatures, getFIRList } from '../lib/firService';

const MAX_SELECTED = 6;

interface FIRState {
  /** All loaded FIR features */
  features: FIRFeature[];
  /** Loading state */
  loading: boolean;
  /** Currently selected FIR IDs (max 6) */
  selectedFIRs: string[];
  /** Whether the FIR layer is enabled at all */
  firLayerEnabled: boolean;
  /** Search query for FIR picker */
  firSearchQuery: string;

  // Actions
  loadFIRs: () => Promise<void>;
  toggleFIR: (firId: string) => void;
  removeFIR: (firId: string) => void;
  clearFIRs: () => void;
  setFIRLayerEnabled: (enabled: boolean) => void;
  setFIRSearchQuery: (query: string) => void;
}

export const useFIRStore = create<FIRState>((set, get) => ({
  features: [],
  loading: false,
  selectedFIRs: [],
  firLayerEnabled: false,
  firSearchQuery: '',

  loadFIRs: async () => {
    if (get().features.length > 0 || get().loading) return;
    set({ loading: true });
    const features = await fetchFIRFeatures();
    set({ features, loading: false });
  },

  toggleFIR: (firId: string) =>
    set((state) => {
      const idx = state.selectedFIRs.indexOf(firId);
      if (idx >= 0) {
        // Deselect
        return { selectedFIRs: state.selectedFIRs.filter((id) => id !== firId) };
      }
      // Select (enforce max)
      if (state.selectedFIRs.length >= MAX_SELECTED) return state;
      return { selectedFIRs: [...state.selectedFIRs, firId] };
    }),

  removeFIR: (firId: string) =>
    set((state) => ({
      selectedFIRs: state.selectedFIRs.filter((id) => id !== firId),
    })),

  clearFIRs: () => set({ selectedFIRs: [] }),

  setFIRLayerEnabled: (firLayerEnabled) => set({ firLayerEnabled }),

  setFIRSearchQuery: (firSearchQuery) => set({ firSearchQuery }),
}));
