/**
 * Component render tests.
 *
 * Bundles the real TSX components (esbuild, same JSX/alias semantics as the app
 * build) and server-renders them with **live API payloads**, so "the SOC console
 * renders attack paths, benign workflows, roles and resources" is asserted
 * against the actual components rather than a mock. The second suite feeds the
 * same components deliberately hostile payloads — the shapes that used to throw
 * inside AttackGraph and blank the page.
 *
 * Requires a prior `npm run build`.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

import {
  BROKEN_PACK,
  BUILD_EXISTS,
  ROOT,
  freePort,
  get,
  postBody,
  startServer,
  stopServer,
  waitForReady,
  writeBrokenPack,
} from './helpers.mjs';

const OUT = path.join(ROOT, '.test-build', 'render-entry.cjs');

let server;
let base;
let hostileServer;
let hostileBase;
let render;
let buildIncidentResponse;
let truncateArn;
let formatTimestamp;

const noop = () => undefined;

before(async () => {
  assert.ok(BUILD_EXISTS, 'no production build found — run `npm run build` first');

  await build({
    entryPoints: [path.join(ROOT, 'tests', 'render-entry.tsx')],
    outfile: OUT,
    bundle: true,
    // CJS: lucide-react ships CJS that does require('react'); an ESM bundle
    // cannot represent that ("Dynamic require of \"react\" is not supported").
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    target: 'node20',
    logLevel: 'silent',
    absWorkingDir: ROOT,
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
    alias: { '@': ROOT },
  });

  const entry = require(OUT);
  render = entry.render;
  buildIncidentResponse = entry.buildIncidentResponse;
  truncateArn = entry.truncateArn;
  formatTimestamp = entry.formatTimestamp;

  writeBrokenPack();

  const portA = await freePort();
  const portB = await freePort();
  base = `http://127.0.0.1:${portA}`;
  hostileBase = `http://127.0.0.1:${portB}`;
  server = startServer(portA);
  hostileServer = startServer(portB, {
    BREACHLOOP_SCENARIOS_DIR: BROKEN_PACK,
    BREACHLOOP_DB_PATH: path.join(path.sep, 'proc', 'nope', 'runs.json'),
  });
  await Promise.all([waitForReady(base, server), waitForReady(hostileBase, hostileServer)]);
});

after(() => {
  stopServer(server);
  stopServer(hostileServer);
  fs.rmSync(BROKEN_PACK, { recursive: true, force: true });
});

/** React escapes text nodes; compare notes after undoing that. */
function unescapeHtml(html) {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Props exactly as SocConsole passes them. */
function propsFor(view) {
  return {
    'HypothesisBar': {
      hypothesis: view.hypothesis,
      attackPath: view.attack_path,
      truncateArn,
    },
    'AttackGraph': {
      attackPath: view.attack_path,
      events: view.events,
      scenarioDetail: view.scenario_detail,
    },
    'EventTimeline': {
      events: view.events,
      attackPathEventIds: new Set(view.attack_path.evidence_event_ids ?? []),
      formatTimestamp,
      truncateArn,
    },
    'RemediationLab': { candidates: view.candidates, simulations: view.simulations },
    'TwinStateInspector': { baselineWorkflows: view.workflows, simulations: view.simulations },
    'EvidenceReportView': { report: view.report, onDownload: noop },
  };
}

async function viewFor(scenarioId) {
  const { json } = await get(base, '/api/incidents/run', postBody({ scenario_id: scenarioId }));
  return buildIncidentResponse(json.report, json.scenario_detail);
}

describe('console renders real payloads', () => {
  it('renders every panel for all 12 scenarios without throwing', async () => {
    const { json: list } = await get(base, '/api/scenarios');
    assert.equal(list.scenarios.length, 12);

    for (const summary of list.scenarios) {
      const view = await viewFor(summary.scenario_id);
      const props = propsFor(view);

      for (const [name, componentProps] of Object.entries(props)) {
        let html;
        try {
          html = render(name, componentProps);
        } catch (error) {
          assert.fail(`${name} threw while rendering ${summary.scenario_id}: ${error.message}`);
        }
        assert.ok(html.length > 0, `${name}/${summary.scenario_id} rendered nothing`);
        assert.ok(!/NaN|undefined%|Infinity/.test(html), `${name}/${summary.scenario_id} leaked NaN/undefined into the DOM`);
      }

      // Attack packs must surface a real path; benign packs must not.
      const graphHtml = render('AttackGraph', props['AttackGraph']);
      // Every topology class the pack actually populates must be on screen
      // (several packs legitimately have no workloads or no standalone principal).
      const detail = view.scenario_detail ?? {};
      const sections = {
        principal: detail.principals,
        role: detail.roles,
        resource: detail.resources,
        workload: detail.workloads,
      };
      const arns = new Set();
      for (const [label, rows] of Object.entries(sections)) {
        for (const row of rows ?? []) arns.add(row?.arn ?? row?.id);
        if ((rows ?? []).length > 0) {
          assert.ok(
            graphHtml.includes(`>${label.toUpperCase()}</text>`),
            `${summary.scenario_id}: ${label} node missing from the graph`
          );
        }
      }
      // Each distinct ARN must be drawn exactly once. An ARN shared by two
      // sections (an instance-profile role listed as both principal and role)
      // used to be clobbered, silently dropping the attacker entry point.
      const drawn = (graphHtml.match(/r="28"/g) ?? []).length;
      assert.equal(drawn, arns.size, `${summary.scenario_id}: graph drew ${drawn} of ${arns.size} nodes`);
      assert.match(graphHtml, /Benign Workflow/, 'workflow legend missing');
      if (summary.scenario_type === 'attack') {
        // Pulse rings are drawn only for the compromised entry and the target.
        assert.match(graphHtml, /stroke-dasharray="8,4"/, `${summary.scenario_id}: attack nodes not highlighted`);
        const attackEdges = (graphHtml.match(/url\(#arrowhead-attack\)/g) ?? []).length;
        assert.ok(attackEdges > 0, `${summary.scenario_id}: no attack-path edge drawn`);
      }
      assert.match(render('Header', {
        scenario: summary,
        providerMode: 'deterministic',
        onProviderChange: noop,
        onRunIncident: noop,
        onRunBenchmark: noop,
        onDownloadReport: noop,
        onToggleSidebar: noop,
        isRunning: false,
        hasReport: true,
        sidebarOpen: false,
      }), /Run Incident/);
    }
  });

  it('renders the sidebar with attack and benign groups', async () => {
    const { json } = await get(base, '/api/scenarios');
    const html = render('Sidebar', {
      scenarios: json.scenarios,
      selectedScenarioId: json.scenarios[0].scenario_id,
      onScenarioSelect: noop,
      isOpen: false,
      onClose: noop,
    });
    assert.match(html, /Attack Scenarios \(\s*<!-- -->7\s*<!-- -->\)/, 'attack group count wrong');
    assert.match(html, /Benign Workflows \(\s*<!-- -->5\s*<!-- -->\)/, 'benign group count wrong');
    assert.equal((html.match(/sidebar__scenario-type--attack/g) ?? []).length, 7);
    assert.equal((html.match(/sidebar__scenario-type--benign/g) ?? []).length, 5);
    assert.match(html, /Legend/);
  });

  it('renders the benchmark scorecard', async () => {
    const { json } = await get(base, '/api/benchmark/run', postBody(undefined));
    const html = render('BenchmarkModal', { isOpen: true, onClose: noop, benchmark: json });
    assert.match(html, /100/);
    assert.match(html, /SYNTHETIC BENCHMARK RESULTS ONLY/);
    // The scorecard shows the human name, not the pack id.
    assert.match(html, /Compromised Developer Role/);
    assert.match(html, /PASS<\/span>/);
    // The API ships a synthetic-data disclaimer; the scorecard must not drop it,
    // or an analyst reads "100% accuracy" as real-world proof.
    assert.match(html, /SYNTHETIC BENCHMARK RESULTS ONLY/);
  });

  it('surfaces every degradation note and never leaks NaN', async () => {
    const { json } = await get(hostileBase, '/api/benchmark/run', postBody(undefined));
    assert.ok(Array.isArray(json.degradation_notes) && json.degradation_notes.length > 0, 'expected a degraded pack');

    const html = render('BenchmarkModal', { isOpen: true, onClose: noop, benchmark: json });
    assert.ok(!html.includes('NaN'), 'degraded scorecard leaked NaN into the UI');
    assert.ok(!html.includes('undefined<'), 'scorecard printed a literal undefined');
    assert.match(html, /SYNTHETIC BENCHMARK RESULTS ONLY/);
    // Every note the API emitted must reach the analyst, verbatim.
    const rendered = unescapeHtml(html);
    for (const note of json.degradation_notes) {
      assert.ok(rendered.includes(note), `note dropped from the scorecard: ${note}`);
    }
  });

  it('renders the console shell on its own (initial cold state)', () => {
    const html = render('SocConsole', {});
    assert.match(html, /BreachLoop/);
    assert.match(html, /Connecting to BreachLoop|SOC Console/);
  });
});

describe('panels survive hostile payloads', () => {
  it('renders a degraded run produced by a corrupt scenario pack', async () => {
    const { status, json } = await get(hostileBase, '/api/incidents/run', postBody({ scenario_id: 'malformed' }));
    assert.equal(status, 200, 'the API must degrade, not 500');
    assert.equal(json.degraded, true);

    const view = buildIncidentResponse(json.report, json.scenario_detail);
    for (const [name, componentProps] of Object.entries(propsFor(view))) {
      try {
        assert.ok(render(name, componentProps).length > 0, `${name} rendered nothing for a degraded run`);
      } catch (error) {
        assert.fail(`${name} threw on degraded data: ${error.message}`);
      }
    }

    // The bundled pack still serves the full 12 despite the broken directory.
    const { json: list } = await get(hostileBase, '/api/scenarios');
    assert.ok(list.scenarios.length >= 12);
  });

  it('never throws on missing or malformed panel inputs', () => {
    const hostileViews = [
      // Empty attack path (benign) with no topology at all.
      {
        hypothesis: {
          summary: '', attack_vector: '', impacted_identities: [], impacted_resources: [],
          confidence: 0, evidence_event_ids: [], unknowns: [],
        },
        attack_path: { initial_compromise: 'none', target_resource: 'none', steps: [], evidence_event_ids: [] },
        events: [],
        candidates: [],
        simulations: {},
        workflows: [],
        scenario_detail: {
          scenario_id: 'x', name: 'x', description: '', scenario_type: 'attack',
          event_count: 0, workflow_count: 0, candidate_count: 0,
          events: [], principals: [], roles: [], resources: [], workloads: [],
          workflows: [], candidate_remediations: [], ground_truth: {},
        },
        report: null,
      },
      // Attack path referencing nodes that are absent from the topology.
      {
        hypothesis: {
          summary: 's', attack_vector: 'v', impacted_identities: ['a'], impacted_resources: ['b'],
          confidence: 1.4, evidence_event_ids: ['ghost-1'], unknowns: ['u'],
        },
        attack_path: {
          initial_compromise: 'arn:aws:iam::1:user/missing',
          target_resource: 'arn:aws:s3:::missing-bucket',
          steps: [
            { step_number: 1, source_node: 'arn:aws:iam::1:user/missing', action: 'sts:AssumeRole', target_node: 'arn:aws:iam::1:role/ghost', evidence_event_id: 'ghost-1' },
            { step_number: 2, source_node: 'arn:aws:iam::1:role/ghost', action: 's3:GetObject', target_node: 'arn:aws:s3:::missing-bucket', evidence_event_id: 'ghost-2' },
          ],
          evidence_event_ids: ['ghost-1'],
        },
        events: [
          { event_id: 'e1', event_time: 'not-a-date', action: 'a', service: 's', actor_arn: 'arn:x', is_supported: true, raw_evidence: null },
          { event_id: 'e2', event_time: null, action: null, service: undefined, actor_arn: undefined, target_arn: undefined, is_supported: false },
        ],
        candidates: [{ candidate_id: 'c1', action_type: 'weird_type', reasoning: 'r', parameters: { nested: { a: 1 } } }],
        // A simulation present for a candidate, plus a candidate with no simulation.
        simulations: {
          c1: {
            remediation_id: 'c1', remediation_title: 't', status: 'verified', reason: 'because',
            before_reachability: { attacker_entry_arn: 'a', target_resource_arn: 'b', is_reachable: true },
            after_reachability: { attacker_entry_arn: 'a', target_resource_arn: 'b', is_reachable: false },
            workflow_results: [], proof_details: {},
            proof_or_reason: 'because', attacker_reachability_blocked: true, business_workflows_intact: true,
            broken_workflows: [],
          },
        },
        workflows: [{ workflow_name: 'w', principal_arn: 'p', required_action: 'a', target_resource_arn: 't' }],
        scenario_detail: {
          principals: [{ id: 'p1', name: 'P1', arn: 'arn:aws:iam::1:user/ghost', is_compromised: true }],
          roles: [{ id: 'r1', name: 'R1', arn: 'arn:aws:iam::1:role/ghost', trust_policy: {}, attached_policies: [] }],
          resources: [{ id: 'res1', name: 'Ghost bucket', arn: 'arn:aws:s3:::missing-bucket', is_sensitive: true }],
          workloads: [{ id: 'w1', name: 'W1', arn: 'arn:aws:lambda:1', execution_role_arn: 'arn:aws:iam::1:role/ghost' }],
          workflows: [{ id: 'wf1', name: 'WF1', principal_arn: 'p', required_action: 'a', target_resource_arn: 't' }],
          candidate_remediations: [],
          events: [], scenario_id: 'hostile', name: 'Hostile', description: '', scenario_type: 'attack',
          event_count: 0, workflow_count: 0, candidate_count: 0, ground_truth: {},
        },
        report: {
          run_id: 'r', scenario_id: 'hostile', timestamp: 'garbage', provider_mode: 'deterministic',
          synthetic: true, events: [], attack_path: null, hypothesis: null, simulations: [],
          warnings: ['w'], report_id: 'report-r', scenario_name: 'Hostile', scenario_type: 'attack',
          candidates: [],
        },
      },
    ];

    for (const [index, view] of hostileViews.entries()) {
      for (const [name, componentProps] of Object.entries(propsFor(view))) {
        try {
          const html = render(name, componentProps);
          assert.ok(typeof html === 'string');
        } catch (error) {
          assert.fail(`${name} threw on hostile payload #${index}: ${error.message}`);
        }
      }
    }

    // Sidebar / Header / modal with degenerate inputs.
    for (const scenarios of [undefined, null, [], [{}]]) {
      try {
        render('Sidebar', { scenarios, selectedScenarioId: null, onScenarioSelect: noop, isOpen: false, onClose: noop });
      } catch (error) {
        assert.fail(`Sidebar threw for scenarios=${JSON.stringify(scenarios)}: ${error.message}`);
      }
    }
    try {
      render('Header', { scenario: undefined, providerMode: 'anthropic', onProviderChange: noop, onRunIncident: noop, onRunBenchmark: noop, onDownloadReport: noop, onToggleSidebar: noop, isRunning: true, hasReport: false, sidebarOpen: true });
      render('BenchmarkModal', { isOpen: true, onClose: noop, benchmark: null });
      render('EvidenceReportView', { report: null, onDownload: noop });
    } catch (error) {
      assert.fail(`shell components threw on degenerate props: ${error.message}`);
    }
  });

  it('formats broken timestamps and short ARNs without throwing', () => {
    assert.equal(formatTimestamp('nonsense'), 'nonsense', 'unparseable stamps are shown verbatim, never Invalid Date');
    assert.equal(formatTimestamp(''), '—');
    assert.equal(formatTimestamp(undefined), '—');
    assert.equal(truncateArn(''), '—', 'empty ARNs render as an em dash');
    assert.equal(truncateArn(undefined), '—');
    assert.equal(truncateArn('short:arn'), 'short:arn');
    assert.ok(truncateArn(`arn:aws:s3:::${'x'.repeat(80)}`).length <= 51);
  });
});
