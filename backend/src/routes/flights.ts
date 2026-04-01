import type { FastifyInstance } from 'fastify';
import { flightCache } from '../services/cache.js';
import { getTrailHistory } from '../db/sqlite.js';

export async function flightRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/flights — all flights (or filtered by bounds)
  app.get('/api/flights', async (req, reply) => {
    const { south, west, north, east } = req.query as Record<string, string>;

    if (south && west && north && east) {
      const flights = flightCache.getByBounds(
        parseFloat(south),
        parseFloat(west),
        parseFloat(north),
        parseFloat(east)
      );
      return reply.send({ ac: flights, total: flights.length });
    }

    const flights = flightCache.getAll();
    return reply.send({ ac: flights, total: flights.length });
  });

  // GET /api/flights/:icao24 — single flight with trail
  app.get<{ Params: { icao24: string } }>('/api/flights/:icao24', async (req, reply) => {
    const { icao24 } = req.params;
    const flight = flightCache.get(icao24.toLowerCase());
    if (!flight) {
      return reply.code(404).send({ error: 'Flight not found' });
    }

    // Attach trail from SQLite
    const trail = getTrailHistory(icao24.toLowerCase(), 60);
    flight.trail = trail.map(t => ({ lat: t.lat, lon: t.lon, alt: t.alt, ts: t.ts }));

    return reply.send(flight);
  });
}
