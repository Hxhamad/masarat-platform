import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'masarat.db');

let db: Database.Database;

export function initDatabase(): Database.Database {
  db = new Database(DB_PATH);
  
  // WAL mode for concurrent reads during writes
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('temp_store = MEMORY');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS trail_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      icao24 TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      altitude REAL NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trail_icao24 ON trail_history(icao24);
    CREATE INDEX IF NOT EXISTS idx_trail_timestamp ON trail_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_trail_icao24_ts ON trail_history(icao24, timestamp);
  `);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// Prepared statements for performance
let insertTrailStmt: Database.Statement | null = null;
let getTrailStmt: Database.Statement | null = null;
let cleanupStmt: Database.Statement | null = null;

export function insertTrailPoint(icao24: string, lat: number, lon: number, alt: number, ts: number): void {
  if (!insertTrailStmt) {
    insertTrailStmt = db.prepare(
      'INSERT INTO trail_history (icao24, latitude, longitude, altitude, timestamp) VALUES (?, ?, ?, ?, ?)'
    );
  }
  insertTrailStmt.run(icao24, lat, lon, alt, ts);
}

export function getTrailHistory(icao24: string, limit = 60): Array<{ lat: number; lon: number; alt: number; ts: number }> {
  if (!getTrailStmt) {
    getTrailStmt = db.prepare(
      'SELECT latitude as lat, longitude as lon, altitude as alt, timestamp as ts FROM trail_history WHERE icao24 = ? ORDER BY timestamp DESC LIMIT ?'
    );
  }
  return getTrailStmt.all(icao24, limit) as Array<{ lat: number; lon: number; alt: number; ts: number }>;
}

/** Delete trail points older than maxAgeMs (default 24h) */
export function cleanupOldTrails(maxAgeMs = 86_400_000): number {
  if (!cleanupStmt) {
    cleanupStmt = db.prepare('DELETE FROM trail_history WHERE timestamp < ?');
  }
  const result = cleanupStmt.run(Date.now() - maxAgeMs);
  return result.changes;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}
