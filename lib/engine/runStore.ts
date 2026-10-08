/**
 * Incident run store — replacement for `backend/breachloop/storage/database.py`.
 *
 * Why this exists: the reference implementation opened `breachloop.sqlite`
 * relative to the process CWD. On Vercel the function filesystem is read-only
 * (only `/tmp` is writable), so `sqlite3.connect()` threw
 * `OperationalError: unable to open database file` and every endpoint that
 * touched the DB answered 500. Reproduced locally by running the handler in a
 * read-only directory.
 *
 * The replacement is deliberately non-failing:
 *   tier 1  in-process LRU map  (authoritative for a warm container)
 *   tier 2  optional JSON snapshot on disk, best-effort, silently skipped when
 *           the path is unwritable or BREACHLOOP_DISABLE_PERSISTENCE is set
 *   tier 3  deterministic recomputation from the run id (see `decodeRunId`),
 *           so a run created on one container is still resolvable on another
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AttackPath, EvidenceReport, SimulationResult } from './types';

export interface StoredRun {
  run_id: string;
  scenario_id: string;
  provider_mode: string;
  timestamp: string;
  synthetic: boolean;
  hypothesis_summary: string;
  hypothesis_confidence: number;
  attack_path: AttackPath;
  full_report: EvidenceReport;
  simulations: SimulationResult[];
}

const MAX_RUNS = 200;
const RUN_ID_PREFIX = 'run';
const STORE_KEY = Symbol.for('breachloop.runStore');

interface GlobalWithStore {
  [STORE_KEY]?: Map<string, StoredRun>;
}

function memory(): Map<string, StoredRun> {
  const bag = globalThis as unknown as GlobalWithStore;
  if (!bag[STORE_KEY]) bag[STORE_KEY] = new Map();
  return bag[STORE_KEY];
}

function persistenceEnabled(): boolean {
  return !['1', 'true', 'yes'].includes(String(process.env.BREACHLOOP_DISABLE_PERSISTENCE ?? '').toLowerCase());
}

/**
 * Pure string logic — deliberately no filesystem probing here. A snapshot path is
 * operator-supplied (`BREACHLOOP_DB_PATH`), and a synchronous stat/open on a
 * pathological path (e.g. under /proc) would block the event loop for *every*
 * concurrent request, not just this one.
 */
function snapshotPath(): string {
  const configured = process.env.BREACHLOOP_DB_PATH;
  if (configured && configured.trim()) return path.normalize(configured.trim());
  // os.tmpdir() resolves to /tmp on Vercel/Lambda, where writes are allowed.
  return path.join(os.tmpdir(), 'breachloop-runs.json');
}

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
let dirPrepared = false;

/**
 * Best-effort and non-blocking: written asynchronously, never awaited by a
 * response, and every failure is swallowed. A snapshot is a convenience — the
 * in-memory tier plus deterministic recomputation are the guarantees.
 */
function persist(runs: Map<string, StoredRun>): void {
  if (!persistenceEnabled()) return;

  const file = snapshotPath();
  // The full report is never persisted: it is derived JSON that recomputes
  // deterministically from the pack, so keeping it would only bloat the file.
  const payload = JSON.stringify(
    [...runs.values()].slice(-MAX_RUNS).map(run => {
      const snapshot = { ...(run as unknown as Record<string, unknown>) };
      delete snapshot.full_report;
      return snapshot;
    })
  );

  void (async () => {
    try {
      if (!dirPrepared) {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        dirPrepared = true;
      }
      await fs.promises.writeFile(file, payload, 'utf8');
    } catch {
      // Read-only filesystem, missing directory, quota, or a concurrent writer.
      // Exactly the condition that used to throw and 500; here it is a no-op.
    }
  })();
}

function hydrateFromDisk(runs: Map<string, StoredRun>): void {
  if (!persistenceEnabled() || runs.size > 0) return;
  try {
    const file = snapshotPath();
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    // Never read a huge or unexpected file synchronously.
    if (!stat || !stat.isFile() || stat.size === 0 || stat.size > MAX_SNAPSHOT_BYTES) return;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (entry && typeof entry === 'object' && typeof entry.run_id === 'string') {
        if (!runs.has(entry.run_id)) runs.set(entry.run_id, entry as StoredRun);
      }
    }
  } catch {
    /* corrupt or unreadable snapshot — the in-memory tier still works */
  }
}

/**
 * `run-<scenarioId>-<8 hex>`. Embedding the scenario id is what makes tier 3
 * possible: any handler can rebuild the report from the identifier alone, even
 * on a cold container that never saw the POST.
 */
export function encodeRunId(scenarioId: string, suffix: string): string {
  return `${RUN_ID_PREFIX}-${scenarioId}-${suffix}`;
}

/** Recovers the scenario id from a run id, given the known pack. */
export function decodeRunId(runId: string, knownScenarioIds: string[]): string | null {
  if (!runId.startsWith(`${RUN_ID_PREFIX}-`)) return null;
  const body = runId.slice(RUN_ID_PREFIX.length + 1);

  let best: string | null = null;
  for (const id of knownScenarioIds) {
    if (body.startsWith(`${id}-`) && (best === null || id.length > best.length)) best = id;
  }
  if (best) return best;

  // Unknown-but-well-formed id: strip the trailing random segment.
  const parts = body.split('-');
  if (parts.length < 3) return null;
  return parts.slice(0, -1).join('-');
}

export function saveRun(report: EvidenceReport, attackPath: AttackPath, simulations: SimulationResult[]): StoredRun {
  const runs = memory();
  const run: StoredRun = {
    run_id: report.run_id,
    scenario_id: report.scenario_id,
    provider_mode: report.provider_mode,
    timestamp: report.timestamp,
    synthetic: report.synthetic,
    hypothesis_summary: report.hypothesis.summary,
    hypothesis_confidence: report.hypothesis.confidence,
    attack_path: attackPath,
    full_report: report,
    simulations,
  };

  runs.set(run.run_id, run);
  while (runs.size > MAX_RUNS) {
    const oldest = runs.keys().next();
    if (oldest.done) break;
    runs.delete(oldest.value);
  }

  persist(runs);
  return run;
}

export function getRun(runId: string): StoredRun | null {
  const runs = memory();
  const hit = runs.get(runId);
  if (hit) return hit;

  hydrateFromDisk(runs);
  return runs.get(runId) ?? null;
}

export function listRuns(limit = 50): StoredRun[] {
  const runs = memory();
  hydrateFromDisk(runs);
  return [...runs.values()].slice(-limit).reverse();
}

export function runCount(): number {
  return memory().size;
}

/**
 * Reports whether snapshotting can work. Probes the existing parent directory
 * only — it never creates anything, so a bad configured path answers
 * "not writable" in one syscall instead of blocking.
 */
export function persistenceStatus(): { enabled: boolean; path: string; writable: boolean } {
  const enabled = persistenceEnabled();
  const file = snapshotPath();
  let writable = false;
  if (enabled) {
    try {
      fs.accessSync(path.dirname(file), fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
  }
  return { enabled, path: file, writable };
}
