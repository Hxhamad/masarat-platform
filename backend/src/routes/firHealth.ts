/**
 * FIR Health REST Endpoints
 *
 * GET  /api/fir/list                — list all loaded FIR IDs / names
 * GET  /api/fir/:firId/health       — current health summary for one FIR
 * GET  /api/fir/:firId/history      — 24h health history
 * GET  /api/fir/:firId/flights      — live flights inside the FIR
 * POST /api/fir/health              — health summary for multiple FIRs (body: { firIds: string[] })
 * GET  /api/fir/leaderboard         — comparative leaderboard (query: ?firIds=X,Y,Z or all tracked)
 */

import type { FastifyInstance } from 'fastify';
import { getAllFIREntries, getFIREntry, isFIRDataLoaded } from '../services/firLoader.js';
import { getFlightsInFIR } from '../services/firFilter.js';
import { computeFIRHealth, computeMultiFIRHealth } from '../services/kpiEngine.js';
import { getHealthHistory } from '../db/healthStore.js';

export async function firHealthRoutes(app: FastifyInstance): Promise<void> {

  // List all available FIRs
  app.get('/api/fir/list', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    if (!isFIRDataLoaded()) {
      return reply.code(503).send({ error: 'FIR data still loading' });
    }
    const entries = getAllFIREntries();
    const list = entries.map(e => ({
      id: e.feature.properties.id,
      name: e.feature.properties.name,
      country: e.feature.properties.country,
    }));
    return reply.send({ firs: list, total: list.length });
  });

  // Current health for one FIR
  app.get<{ Params: { firId: string } }>('/api/fir/:firId/health', async (req, reply) => {
    const { firId } = req.params;
    const entry = getFIREntry(firId);
    if (!entry) return reply.code(404).send({ error: `FIR ${firId} not found` });

    const health = computeFIRHealth(firId);
    return reply.send({
      ...health,
      firName: entry.feature.properties.name,
      country: entry.feature.properties.country,
    });
  });

  // 24h health history
  app.get<{ Params: { firId: string }; Querystring: { hours?: string } }>(
    '/api/fir/:firId/history',
    async (req, reply) => {
      const { firId } = req.params;
      if (!getFIREntry(firId)) return reply.code(404).send({ error: `FIR ${firId} not found` });

      const hours = parseInt(req.query.hours ?? '24', 10) || 24;
      const history = getHealthHistory(firId, Math.min(hours, 168));
      return reply.send({ firId, history });
    }
  );

  // Live flights inside an FIR
  app.get<{ Params: { firId: string } }>('/api/fir/:firId/flights', async (req, reply) => {
    const { firId } = req.params;
    if (!getFIREntry(firId)) return reply.code(404).send({ error: `FIR ${firId} not found` });

    const flights = getFlightsInFIR(firId);
    return reply.send({ firId, ac: flights, total: flights.length });
  });

  // Multi-FIR health (POST with body)
  app.post<{ Body: { firIds: string[] } }>('/api/fir/health', async (req, reply) => {
    const { firIds } = req.body ?? {};
    if (!Array.isArray(firIds) || firIds.length === 0) {
      return reply.code(400).send({ error: 'firIds array required' });
    }
    // Cap at 20 for performance
    const ids = firIds.slice(0, 20);
    const results = computeMultiFIRHealth(ids);
    return reply.send({ results });
  });

  // Global leaderboard
  app.get('/api/fir/leaderboard', async (req, reply) => {
    const { firIds: raw } = req.query as Record<string, string>;
    let ids: string[];

    if (raw) {
      ids = raw.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      // Default: use all loaded FIRs (may be slow for 300+ FIRs)
      // In practice, callers should supply a subset
      ids = getAllFIREntries().slice(0, 30).map(e => e.feature.properties.id);
    }

    const results = computeMultiFIRHealth(ids);
    const sorted = results.sort((a, b) => b.chi - a.chi);

    return reply.send({
      leaderboard: sorted.map((r, idx) => ({
        rank: idx + 1,
        firId: r.firId,
        firName: r.firName,
        country: r.country,
        chi: r.chi,
        flightCount: r.flightCount,
        efficiencyScore: r.efficiencyScore,
        saturationPct: r.saturationPct,
        co2EstimateKg: r.co2EstimateKg,
      })),
    });
  });
}
