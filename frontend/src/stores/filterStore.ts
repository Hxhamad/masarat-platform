import { create } from 'zustand';

export type FlightTypeFilter = 'airline' | 'private' | 'cargo' | 'military' | 'ground' | 'helicopter';

interface FilterState {
  searchQuery: string;
  altitudeRange: [number, number]; // feet
  activeTypes: Set<FlightTypeFilter>;

  setSearchQuery: (q: string) => void;
  setAltitudeRange: (range: [number, number]) => void;
  toggleType: (type: FlightTypeFilter) => void;
  resetFilters: () => void;
}

const ALL_TYPES: FlightTypeFilter[] = ['airline', 'private', 'cargo', 'military', 'ground', 'helicopter'];

export const useFilterStore = create<FilterState>((set) => ({
  searchQuery: '',
  altitudeRange: [0, 60_000],
  activeTypes: new Set(ALL_TYPES),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setAltitudeRange: (altitudeRange) => set({ altitudeRange }),

  toggleType: (type) =>
    set((state) => {
      const next = new Set(state.activeTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { activeTypes: next };
    }),

  resetFilters: () =>
    set({
      searchQuery: '',
      altitudeRange: [0, 60_000],
      activeTypes: new Set(ALL_TYPES),
    }),
}));
