/**
 * BreachLoop end-to-end API tests.
 *
 * These run against a real `next start` production server (no mocks), because every
 * defect this suite guards against was an integration defect: a read-only
 * filesystem, a missing scenario directory, a cold start, an operator-supplied
 * path blocking the event loop. Unit tests over the pure engine could not have
 * caught any of them.
 *
 * Requires a prior `npm run build`. Run: npm test
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BROKEN_PACK,
  BUILD_EXISTS,
  freePort,
  get,
  postBody,
  startServer,
  stopServer,
  waitForReady,
  writeBrokenPack,
} from './helpers.mjs';

let serverA;
let serverB;
let baseA;
let baseB;

before(async () => {
  assert.ok(BUILD_EXISTS, 'no production build found — run `npm run build` first');
  writeBrokenPack();

  const portA = await freePort();
  const portB = await freePort();
  baseA = `http://127.0.0.1:${portA}`;
  baseB = `http://127.0.0.1:${portB}`;

  serverA = startServer(portA, {});
  serverB = startServer(portB, {
    BREACHLOOP_SCENARIOS_DIR: BROKEN_PACK,
    // A path that can be neither created nor written: must degrade, never block.
    BREACHLOOP_DB_PATH: '/proc/nope/runs.json',
  });

  await Promise.all([waitForReady(baseA, serverA), waitForReady(baseB, serverB)]);
});

after(() => {
  stopServer(serverA);
  stopServer(serverB);
});

describe('health + readiness', () => {
  it('answers 200 with the capability report the console needs', async () => {
    const { status, json } = await get(baseA, '/api/health');
    assert.equal(status, 200);
    assert.equal(json.service, 'breachloop');
    assert.equal(json.runtime, 'nextjs-api');
    assert.ok(json.scenarios >= 12, `expected the bundled 12-scenario pack, got ${json.scenarios}`);
    assert.ok(['healthy', 'degraded'].includes(json.status));
  });

  it('serves the static console shell (cold start never depends on the API)', async () => {
    const { status, text } = await get(baseA, '/');
    assert.equal(status, 200);
    assert.match(text, /BreachLoop \| Incident Response Simulator/);
    assert.match(text, /<div id="app"|class="app"/);
  });
});

describe('scenario pack', () => {
  it('lists 12 scenarios: 7 attack and 5 benign', async () => {
    const { status, json } = await get(baseA, '/api/scenarios');
    assert.equal(status, 200);
    assert.equal(json.scenarios.length, 12);
    assert.equal(json.scenarios.filter((s) => s.scenario_type === 'attack').length, 7);
    assert.equal(json.scenarios.filter((s) => s.scenario_type === 'benign').length, 5);
  });

  it('returns detail with the topology the attack graph renders', async () => {
    const { status, json } = await get(baseA, '/api/scenarios/compromised-role');
    assert.equal(status, 200);
    for (const key of ['principals', 'roles', 'resources', 'workloads', 'workflows', 'candidate_remediations']) {
      assert.ok(Array.isArray(json[key]), `${key} must be an array`);
    }
    assert.ok(json.resources.some((r) => r.is_sensitive), 'expected a sensitive resource');
    assert.ok(json.principals.some((p) => p.is_compromised), 'expected a compromised principal');
  });

  it('attaches a bounded, pack-derived briefing to every listed scenario', async () => {
    const { status, text, json } = await get(baseA, '/api/scenarios');
    assert.equal(status, 200);

    for (const scenario of json.scenarios) {
      const briefing = scenario.briefing;
      assert.ok(briefing, `${scenario.scenario_id} must ship a briefing for the launch pad`);
      assert.ok(Array.isArray(briefing.services) && briefing.services.length > 0, `${scenario.scenario_id}: services`);
      assert.ok(
        briefing.services.every((service) => typeof service === 'string' && service !== 'unknown'),
        `${scenario.scenario_id}: normalizer placeholders must not reach the UI as service names`
      );
      assert.ok(briefing.glyph.nodes.length <= 6, `${scenario.scenario_id}: glyph nodes must stay bounded`);
      assert.ok(briefing.glyph.links.length <= 8, `${scenario.scenario_id}: glyph links must stay bounded`);
      for (const node of briefing.glyph.nodes) {
        assert.ok(['principal', 'role', 'workload', 'resource'].includes(node.kind), `${scenario.scenario_id}: node kind`);
        assert.ok(node.label && node.arn, `${scenario.scenario_id}: glyph nodes carry their identity`);
      }
      for (const link of briefing.glyph.links) {
        assert.ok(
          Number.isInteger(link.from) && Number.isInteger(link.to) && briefing.glyph.nodes[link.from] && briefing.glyph.nodes[link.to],
          `${scenario.scenario_id}: glyph links must index real nodes`
        );
      }
      for (const key of ['event_count', 'workflow_count', 'candidate_count']) {
        assert.equal(typeof scenario[key], 'number', `${scenario.scenario_id}.${key} must be numeric`);
      }
      const { first, last, span_minutes } = briefing.window;
      assert.ok(first && last, `${scenario.scenario_id}: an event window must be reported`);
      assert.ok(Date.parse(first) <= Date.parse(last), `${scenario.scenario_id}: window must be ordered`);
      assert.ok(Number.isInteger(span_minutes) && span_minutes >= 0, `${scenario.scenario_id}: span_minutes`);
    }

    // The pad previews scope, never the verdict — ground truth must not ride
    // along on the listing, in any form.
    for (const forbidden of ['ground_truth', 'expected_broad_remediation_status', 'expected_narrow_remediation_status']) {
      assert.ok(!text.includes(forbidden), `GET /api/scenarios leaked ${forbidden}`);
    }
  });

  it('still briefs a pack that had to be coerced, instead of blanking the pad', async () => {
    // serverB runs against a directory containing a deliberately malformed pack.
    const { status, json } = await get(baseB, '/api/scenarios');
    assert.equal(status, 200);
    assert.ok(json.scenarios.length >= 1, 'the corrupt directory must not empty the listing');
    for (const scenario of json.scenarios) {
      const briefing = scenario.briefing;
      assert.ok(briefing, `${scenario.scenario_id}: a coerced pack still needs a briefing`);
      assert.ok(briefing.glyph.nodes.length <= 6 && briefing.glyph.links.length <= 8, `${scenario.scenario_id}: bounds`);
      assert.ok(Number.isFinite(briefing.window.span_minutes), `${scenario.scenario_id}: unparseable timestamps must not yield NaN`);
    }
  });

  it('answers 404 — not 500 — for an unknown scenario', async () => {
    const { status, json } = await get(baseA, '/api/scenarios/definitely-not-here');
    assert.equal(status, 404);
    assert.equal(json.error, 'not_found');
  });
});

describe('incident run', () => {
  it('runs every scenario and returns the report inline in one response', async () => {
    const { json: list } = await get(baseA, '/api/scenarios');
    for (const summary of list.scenarios) {
      const { status, json } = await get(baseA, '/api/incidents/run', postBody({ scenario_id: summary.scenario_id }));
      assert.equal(status, 200, `${summary.scenario_id} did not return 200`);
      assert.equal(json.status, 'completed');
      assert.ok(json.run_id.startsWith(`run-${summary.scenario_id}-`));
      assert.ok(json.report, `${summary.scenario_id} missing inline report`);
      assert.ok(json.scenario_detail, `${summary.scenario_id} missing inline scenario_detail`);

      const { attack_path: path2, hypothesis, simulations, warnings } = json.report;
      assert.ok(Array.isArray(path2.steps), `${summary.scenario_id} attack_path.steps missing`);
      assert.equal(typeof hypothesis.confidence, 'number');
      assert.ok(hypothesis.confidence >= 0 && hypothesis.confidence <= 1);
      assert.equal(simulations.length, summary.candidate_count, `${summary.scenario_id} simulated every candidate`);
      assert.equal(warnings.length, 2, 'synthetic disclaimers are mandatory');
      assert.equal(json.degraded, undefined, `${summary.scenario_id} should not be degraded`);

      // The engine's central claim: attacks produce a path, benign packs produce none.
      if (summary.scenario_type === 'attack') {
        assert.ok(path2.steps.length > 0, `${summary.scenario_id} attack produced no path`);
        assert.notEqual(path2.initial_compromise, 'none', 'an attack path must name a real entry point');
        assert.ok(
          path2.steps.every((step) => typeof step.evidence_event_id === 'string' && step.evidence_event_id.length > 0),
          `${summary.scenario_id}: every step must carry evidence`
        );
      } else {
        assert.equal(path2.steps.length, 0, `${summary.scenario_id} benign pack must not yield an attack path`);
        assert.equal(path2.initial_compromise, 'none', 'benign packs use the empty-path sentinel');
      }
    }
  });

  it('rejects a missing body with 400, never 500', async () => {
    const { status, json } = await get(baseA, '/api/incidents/run', postBody('{"scenario_id":'));
    assert.equal(status, 400);
    assert.match(json.detail, /scenario_id is required/);
  });

  it('rejects an unknown scenario with 404', async () => {
    const { status, json } = await get(baseA, '/api/incidents/run', postBody({ scenario_id: 'ghost' }));
    assert.equal(status, 404);
    assert.match(json.detail, /Scenario not found/);
  });
});

describe('report + simulate + export', () => {
  it('re-reads a stored report and re-derives an unknown run deterministically', async () => {
    const { json } = await get(baseA, '/api/incidents/run', postBody({ scenario_id: 'sts-pivot-exfil' }));

    const stored = await get(baseA, `/api/incidents/${json.run_id}/report`);
    assert.equal(stored.status, 200);
    assert.equal(stored.json.run_id, json.run_id);
    assert.equal(stored.json.recomputed, undefined);

    // A run id this instance never saw must still resolve, not 404/500.
    const syntheticId = 'run-sts-pivot-exfil-0000000000';
    const derived = await get(baseA, `/api/incidents/${syntheticId}/report`);
    assert.equal(derived.status, 200);
    assert.equal(derived.json.recomputed, true);
    assert.equal(derived.json.attack_path.steps.length, stored.json.attack_path.steps.length);
  });

  it('simulates a single candidate and reports the verified outcome', async () => {
    const { json } = await get(baseA, '/api/incidents/run', postBody({ scenario_id: 'compromised-role' }));
    const { status, json: sim } = await get(
      baseA,
      `/api/incidents/${json.run_id}/simulate`,
      postBody({ remediation_id: 'fix-narrow-01' })
    );
    assert.equal(status, 200);
    assert.equal(sim.status, 'verified');
    assert.equal(sim.after_reachability.is_reachable, false);
    assert.ok(sim.workflow_results.every((w) => w.is_operational), 'narrow fix must preserve workflows');

    const broad = await get(baseA, `/api/incidents/${json.run_id}/simulate`, postBody({ remediation_id: 'fix-broad-01' }));
    assert.equal(broad.status, 200);
    assert.equal(broad.json.status, 'rejected');
    assert.ok(/Disrupts business workflow/.test(broad.json.reason));
  });

  it('answers 404 with the valid candidate ids for an unknown candidate', async () => {
    const { json } = await get(baseA, '/api/incidents/run', postBody({ scenario_id: 'compromised-role' }));
    const { status, json: body } = await get(baseA, `/api/incidents/${json.run_id}/simulate`, postBody({ remediation_id: 'nope' }));
    assert.equal(status, 404);
    assert.match(body.detail, /Available: fix-broad-01, fix-narrow-01/);
  });

  it('exports incident logs as JSON, JSONL and CSV', async () => {
    const { json } = await get(baseA, '/api/incidents/run', postBody({ scenario_id: 'kms-ransomware' }));

    const listing = await get(baseA, '/api/reports');
    assert.equal(listing.status, 200);
    assert.ok(listing.json.total >= 1);

    const jsonl = await get(baseA, `/api/reports/${json.run_id}?format=jsonl`);
    assert.equal(jsonl.status, 200);
    assert.match(jsonl.headers.get('content-type'), /x-ndjson/);
    const lines = jsonl.text.trim().split('\n');
    assert.equal(lines.length, json.report.events.length);
    for (const line of lines) assert.equal(typeof JSON.parse(line).event_id, 'string');

    const csv = await get(baseA, `/api/reports/${json.run_id}?format=csv`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.equal(csv.text.trim().split('\n').length, json.report.events.length + 1);

    const download = await get(baseA, `/api/reports/${json.run_id}?download=1`);
    assert.match(download.headers.get('content-disposition'), /attachment; filename="breachloop-report-/);
    assert.equal(JSON.parse(download.text).run_id, json.run_id);
  });
});

describe('benchmark', () => {
  it('scores the full pack at 100% via POST and GET', async () => {
    for (const method of ['POST', 'GET']) {
      const { status, json } = await get(baseA, '/api/benchmark/run', method === 'POST' ? postBody(undefined) : undefined);
      assert.equal(status, 200);
      assert.equal(json.total_scenarios, 12);
      assert.equal(json.failed_scenarios, 0, `failures: ${JSON.stringify(json.results.filter((r) => !r.passed))}`);
      assert.equal(json.accuracy_percentage, 100);
      assert.equal(json.attack_scenarios_count, 7);
      assert.equal(json.benign_scenarios_count, 5);
      assert.match(json.disclaimer, /SYNTHETIC BENCHMARK RESULTS ONLY/);
      for (const result of json.results.filter((r) => r.scenario_type === 'attack')) {
        assert.match(result.broad_fix_status, /expected:rejected,actual:rejected/);
        assert.match(result.narrow_fix_status, /expected:verified,actual:verified/);
        assert.equal(result.workflow_preservation_pass, true);
      }
    }
  });
});

describe('degraded environments', () => {
  it('serves fallback data instead of HTTP 500 when the pack and store are broken', async () => {
    const health = await get(baseB, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.persistence.writable, false, 'unwritable snapshot path must be reported, not fatal');

    const scenarios = await get(baseB, '/api/scenarios');
    assert.equal(scenarios.status, 200);
    // Bundled pack survives even though the configured directory is unusable.
    assert.ok(scenarios.json.scenarios.length >= 12);

    const malformed = await get(baseB, '/api/incidents/run', postBody({ scenario_id: 'malformed' }));
    assert.equal(malformed.status, 200, 'a structurally broken scenario must degrade, not 500');
    assert.equal(malformed.json.status, 'completed');
    assert.equal(malformed.json.degraded, true);
    assert.ok(
      malformed.json.degradation_notes.some((note) => /unknown remediation_type/.test(note)),
      `expected a coercion note, got ${JSON.stringify(malformed.json.degradation_notes)}`
    );
    assert.ok(
      malformed.json.degradation_notes.some((note) => /without an `arn`/.test(note)),
      'invalid nodes are skipped with a note'
    );
  });

  it('stays responsive under parallel load with an unwritable data path', async () => {
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        get(baseB, '/api/incidents/run', postBody({ scenario_id: 'snapshot-share' })).then((r) => r.status)
      )
    );
    assert.deepEqual([...new Set(results)], [200], 'every concurrent run must return 200');
    assert.ok(Date.now() - started < 20000, 'a config-driven path must never block the event loop');

    const after = await get(baseB, '/api/health');
    assert.equal(after.status, 200, 'health must still answer after load');
  });

  it('falls back to deterministic mode when anthropic is requested without a key', async () => {
    const { status, json } = await get(baseA, '/api/incidents/run', postBody({ scenario_id: 'compromised-role', provider_mode: 'anthropic' }));
    assert.equal(status, 200);
    assert.equal(json.provider_mode, 'deterministic');
    assert.ok(json.degradation_notes.some((note) => /ANTHROPIC_API_KEY is not configured/.test(note)));
  });
});
