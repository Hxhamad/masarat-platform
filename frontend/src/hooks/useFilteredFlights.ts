import { useMemo } from 'react';
import { useFlightStore } from '../stores/flightStore';
import { useFilterStore, type FlightTypeFilter } from '../stores/filterStore';
import type { ADSBFlight } from '../types/flight';

export function useFilteredFlights(): ADSBFlight[] {
  const flights = useFlightStore((s) => s.flights);
  const { searchQuery, altitudeRange, activeTypes } = useFilterStore();

  return useMemo(() => {
    const results: ADSBFlight[] = [];
    const query = searchQuery.toLowerCase().trim();
    const [minAlt, maxAlt] = altitudeRange;

    for (const f of flights.values()) {
      // Type filter
      if (!activeTypes.has(f.type as FlightTypeFilter)) continue;

      // Altitude filter
      if (f.altitude < minAlt || f.altitude > maxAlt) continue;

      // Search filter
      if (query) {
        const match =
          f.icao24.includes(query) ||
          f.callsign.toLowerCase().includes(query) ||
          f.registration.toLowerCase().includes(query) ||
          f.aircraftType.toLowerCase().includes(query);
        if (!match) continue;
      }

      results.push(f);
    }

    return results;
  }, [flights, searchQuery, altitudeRange, activeTypes]);
}
