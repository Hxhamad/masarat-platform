import type { FastifyInstance } from 'fastify';
import { getWeatherRiskGeoJSON } from '../services/weatherProvider.js';
import { getGnssJammingRiskGeoJSON } from '../services/gnssAnalytics.js';
import type { Bounds } from '../services/hexGrid.js';

function parseBounds(raw: string | undefined): Bounds | null {
	if (!raw) return null;

	const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()));
	if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
		return null;
	}

	const [south, west, north, east] = parts;
	if (
		south < -90 || south > 90 ||
		north < -90 || north > 90 ||
		west < -180 || west > 180 ||
		east < -180 || east > 180 ||
		south > north ||
		west > east
	) {
		return null;
	}

	return { south, west, north, east };
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
	const parsed = Number.parseInt(raw ?? '', 10);
	if (Number.isNaN(parsed)) return fallback;
	return Math.max(min, Math.min(max, parsed));
}

export async function overlayLayersRoutes(app: FastifyInstance): Promise<void> {
	app.get('/api/layers/weather-risk', async (req, reply) => {
		reply.header('Cache-Control', 'no-cache, max-age=0');

		const { bbox, z } = req.query as Record<string, string | undefined>;
		const bounds = parseBounds(bbox);
		if (!bounds) {
			return reply.code(400).send({ error: 'Invalid bbox. Expected bbox=south,west,north,east' });
		}

		return reply.send(await getWeatherRiskGeoJSON({
			bounds,
			zoom: clampInt(z, 6, 1, 18),
		}));
	});

	app.get('/api/layers/gnss-jamming-risk', async (req, reply) => {
		reply.header('Cache-Control', 'no-cache, max-age=0');

		const { bbox, z, minutes } = req.query as Record<string, string | undefined>;
		const bounds = parseBounds(bbox);
		if (!bounds) {
			return reply.code(400).send({ error: 'Invalid bbox. Expected bbox=south,west,north,east' });
		}

		return reply.send(getGnssJammingRiskGeoJSON({
			bounds,
			zoom: clampInt(z, 6, 1, 18),
			minutes: clampInt(minutes, 15, 5, 60),
		}));
	});
}
