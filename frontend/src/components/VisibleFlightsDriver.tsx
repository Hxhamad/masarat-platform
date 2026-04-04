import { useEffect } from 'react';
import { useFilteredFlights } from '../hooks/useFilteredFlights';
import { useFIRFilter } from '../hooks/useFIRFilter';
import { useFIRHealth } from '../hooks/useFIRHealth';
import { useVisibleFlightStore } from '../stores/visibleFlightStore';

/**
 * Computes the visible-flight list once and writes it to a shared store.
 * Also keeps FIR health polling alive for diagnostics badges.
 * Mount this once in App — FlightMap and ADSBPanel read from the store.
 */
export default function VisibleFlightsDriver() {
  const filteredFlights = useFilteredFlights();
  const flights = useFIRFilter(filteredFlights);
  const setVisibleFlights = useVisibleFlightStore((s) => s.setVisibleFlights);

  // Keep health polling alive regardless of view mode
  useFIRHealth();

  useEffect(() => {
    setVisibleFlights(flights);
  }, [flights, setVisibleFlights]);

  return null;
}
