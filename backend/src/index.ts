import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import { initDatabase, closeDatabase, cleanupOldTrails } from './db/sqlite.js';
import { initWebSocket } from './ws/flightHandler.js';
import { startAggregator, stopAggregator } from './services/adsbAggregator.js';
import { flightRoutes } from './routes/flights.js';
import { statsRoutes } from './routes/stats.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

async function start(): Promise<void> {
  // Initialize SQLite
  initDatabase();
  console.log('[db] SQLite initialized (WAL mode)');

  // Create Fastify
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(compress);

  // Register REST routes
  await app.register(flightRoutes);
  await app.register(statsRoutes);

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  // Start HTTP server
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[server] HTTP listening on :${PORT}`);

  // Attach WebSocket to the underlying Node HTTP server
  const httpServer = app.server;
  initWebSocket(httpServer);

  // Start ADS-B data aggregator
  startAggregator();

  // Periodic trail cleanup every hour
  const cleanupInterval = setInterval(() => {
    const removed = cleanupOldTrails();
    if (removed > 0) console.log(`[db] Cleaned up ${removed} old trail points`);
  }, 3_600_000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[server] Shutting down...');
    clearInterval(cleanupInterval);
    stopAggregator();
    closeDatabase();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
