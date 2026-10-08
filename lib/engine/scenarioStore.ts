/**
 * Scenario registry — disk + bundled + synthetic fallback.
 * Server-only module (imports `node:fs`); never throws, always resolves.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED_SCENARIOS, buildSyntheticScenario, toScenarioData, type ScenarioData } from './scenarioSchema';

export interface ScenarioSummary {
  scenario_id: string;
  name: string;
  description: string;
  scenario_type: string;
  event_count: number;
  workflow_count: number;
  candidate_count: number;
}

export type ScenarioSource = 'disk' | 'bundled' | 'synthetic';

export interface ScenarioRegistry {
  order: string[];
  scenarios: Map<string, ScenarioData>;
  sources: Map<string, ScenarioSource>;
  notes: string[];
}

const REGISTRY_KEY = Symbol.for('breachloop.scenarioRegistry');

interface GlobalWithRegistry {
  [REGISTRY_KEY]?: ScenarioRegistry;
}

function scenariosDirCandidates(): string[] {
  const configured = process.env.BREACHLOOP_SCENARIOS_DIR;
  return [configured, path.join(process.cwd(), 'scenarios'), path.join(process.cwd(), '..', 'scenarios')].filter(
    (value): value is string => Boolean(value)
  );
}

function readDiskScenarios(notes: string[]): Map<string, unknown> {
  const found = new Map<string, unknown>();
  for (const dir of scenariosDirCandidates()) {
    let entries: string[];
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      entries = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    } catch (error) {
      // Unreadable directory is a soft failure: the bundled pack covers us.
      notes.push(`scenarios dir ${dir} unreadable (${(error as Error).message})`);
      continue;
    }

    for (const name of entries.sort()) {
      const id = name.replace(/\.json$/, '');
      if (found.has(id)) continue;
      try {
        found.set(id, JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
      } catch (error) {
        notes.push(`scenario ${name} could not be parsed (${(error as Error).message}); using bundled copy`);
      }
    }
  }
  return found;
}

function buildRegistry(): ScenarioRegistry {
  const notes: string[] = [];
  const scenarios = new Map<string, ScenarioData>();
  const sources = new Map<string, ScenarioSource>();

  let disk: Map<string, unknown> = new Map();
  try {
    disk = readDiskScenarios(notes);
  } catch (error) {
    notes.push(`scenario directory scan failed (${(error as Error).message}); using bundled pack`);
  }

  const ids = [...new Set([...Object.keys(BUNDLED_SCENARIOS), ...disk.keys()])];

  for (const id of ids) {
    const raw = disk.has(id) ? disk.get(id) : BUNDLED_SCENARIOS[id];
    const scenario = toScenarioData(raw, id);
    scenarios.set(id, scenario);
    sources.set(id, disk.has(id) ? 'disk' : 'bundled');
    for (const warning of scenario.parse_warnings) notes.push(`${id}: ${warning}`);
  }

  if (scenarios.size === 0) {
    notes.push('no scenario pack found on disk or in the bundle; serving a generated synthetic scenario');
    const synthetic = buildSyntheticScenario();
    scenarios.set(synthetic.id, synthetic);
    sources.set(synthetic.id, 'synthetic');
  }

  // Stable ordering: attacks first, then benign, then id — matches the SQL
  // `ORDER BY scenario_type, scenario_id` the old endpoint used.
  const order = [...scenarios.keys()].sort((a, b) => {
    const sa = scenarios.get(a)!.scenario_type;
    const sb = scenarios.get(b)!.scenario_type;
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  return { order, scenarios, sources, notes };
}

/**
 * Cached on globalThis so a warm lambda container reuses the parsed pack
 * instead of re-reading and re-validating on every invocation.
 */
export function getRegistry(): ScenarioRegistry {
  const bag = globalThis as unknown as GlobalWithRegistry;
  if (!bag[REGISTRY_KEY]) bag[REGISTRY_KEY] = buildRegistry();
  return bag[REGISTRY_KEY];
}

export function listScenarios(): { summaries: ScenarioSummary[]; notes: string[] } {
  const registry = getRegistry();
  const summaries = registry.order.map((id) => {
    const scenario = registry.scenarios.get(id)!;
    return {
      scenario_id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      scenario_type: scenario.scenario_type,
      event_count: scenario.raw_events.length,
      workflow_count: scenario.workflows.length,
      candidate_count: scenario.candidate_remediations.length,
    };
  });
  return { summaries, notes: registry.notes };
}

export function getScenario(id: string): { scenario: ScenarioData; source: ScenarioSource; notes: string[] } | null {
  const registry = getRegistry();
  const exact = registry.scenarios.get(id);
  if (exact) return { scenario: exact, source: registry.sources.get(id) ?? 'bundled', notes: registry.notes };

  // Tolerate `-` / `_` interchange and path-ish inputs, like the old loader did.
  const normalized = id.replace(/[^a-zA-Z0-9_-]/g, '');
  for (const candidate of [normalized, normalized.replace(/-/g, '_'), normalized.replace(/_/g, '-')]) {
    const scenario = registry.scenarios.get(candidate);
    if (scenario) return { scenario, source: registry.sources.get(candidate) ?? 'bundled', notes: registry.notes };
  }

  return null;
}

/** Every scenario, for the benchmark suite. */
export function allScenarios(): ScenarioData[] {
  const registry = getRegistry();
  return registry.order.map((id) => registry.scenarios.get(id)!);
}

export function scenarioCount(): number {
  return getRegistry().scenarios.size;
}
