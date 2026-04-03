/**
 * Health Poller
 *
 * Periodically computes FIR health snapshots for tracked FIRs.
 * Runs every 60s, persisting results to SQLite for the history API.
 */

import { getAllFIREntries } from './firLoader.js';
import { computeFIRHealth } from './kpiEngine.js';
import type { FIRHealthSnapshot, InefficiencyEntry } from '../types/fir.js';

const POLL_INTERVAL = 60_000; // 60s

let timer: ReturnType<typeof setInterval> | null = null;

// In-memory latest health cache for quick reads
const latestHealth = new Map<string, FIRHealthSnapshot & {
  topInefficient: InefficiencyEntry[];
  saturationPct: number;
}>();

function pollOnce(): void {
  const entries = getAllFIREntries();
  if (entries.length === 0) return;

  // Only compute for FIRs; cap at reasonable number per tick
  const toProcess = entries.slice(0, 50);
  let computed = 0;

  for (const entry of toProcess) {
    try {
      const firId = entry.feature.properties.id;
      const health = computeFIRHealth(firId);
      latestHealth.set(firId, health);
      computed++;
    } catch (err) {
      // Skip individual FIR failures
    }
  }

  if (computed > 0) {
    console.log(`[health] Computed health for ${computed} FIRs`);
  }
}

export function startHealthPoller(): void {
  console.log('[health] Starting periodic health computation');
  // Run once immediately
  pollOnce();
  timer = setInterval(pollOnce, POLL_INTERVAL);
}

export function stopHealthPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function getCachedHealth(firId: string) {
  return latestHealth.get(firId);
}

export function getAllCachedHealth() {
  return latestHealth;
}
