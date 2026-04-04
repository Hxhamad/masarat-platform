import { create } from 'zustand';
import type { ADSBFlight, AggregatorStats, ConnectionStatus, DataSource } from '../types/flight';

interface FlightState {
  flights: Map<string, ADSBFlight>;
  selectedFlight: string | null;
  stats: AggregatorStats;
  connectionStatus: ConnectionStatus;
  lastMessageAt: number;

  // Actions
  setFlights: (flights: ADSBFlight[]) => void;
  removeFlights: (icao24s: string[]) => void;
  selectFlight: (icao24: string | null) => void;
  setStats: (stats: AggregatorStats) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
}

export const useFlightStore = create<FlightState>((set) => ({
  flights: new Map(),
  selectedFlight: null,
  stats: {
    totalFlights: 0,
    dataSource: 'adsb-lol' as DataSource,
    lastUpdate: 0,
    messagesPerSecond: 0,
  },
  connectionStatus: 'disconnected' as ConnectionStatus,
  lastMessageAt: 0,

  setFlights: (incoming) =>
    set((state) => {
      const next = new Map(state.flights);
      for (const f of incoming) {
        next.set(f.icao24, f);
      }
      return { flights: next, lastMessageAt: Date.now() };
    }),

  removeFlights: (icao24s) =>
    set((state) => {
      const next = new Map(state.flights);
      for (const id of icao24s) {
        next.delete(id);
      }
      return { flights: next };
    }),

  selectFlight: (icao24) => set({ selectedFlight: icao24 }),

  setStats: (stats) => set({ stats }),

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
}));
