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
let filterLaunchTargets;
let awsDocFor;
let shortArn;
let serviceHintFromKey;
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
  filterLaunchTargets = entry.filterLaunchTargets;
  awsDocFor = entry.awsDocFor;
  shortArn = entry.shortArn;
  serviceHintFromKey = entry.serviceHintFromKey;

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

/**
 * The text of each `@media (prefers-reduced-motion: reduce)` block. Matched by
 * braces rather than "everything after the last header", which would silently
 * move the contract the moment a later feature appended its own block.
 */
function reducedMotionBlocks(css) {
  const marker = '@media (prefers-reduced-motion: reduce)';
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(marker, from);
    if (start === -1) return blocks;
    const open = css.indexOf('{', start);
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1;
      else if (css[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(css.slice(open + 1, end));
    from = end + 1;
  }
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
      const headerHtml = render('Header', {
        scenario: summary,
        providerMode: 'deterministic',
        onProviderChange: noop,
        onRunIncident: noop,
        onRunBenchmark: noop,
        onDownloadReport: noop,
        onToggleSidebar: noop,
        onHome: noop,
        isRunning: false,
        hasReport: true,
        sidebarOpen: false,
      });
      assert.match(headerHtml, /Run Incident/);
      // Home is the "start over" control: labelled, and first in the actions.
      assert.match(headerHtml, /aria-label="Home — back to target selection"/);
      const homeAt = headerHtml.indexOf('header__home');
      assert.ok(homeAt > -1, 'home button missing from the header');
      assert.ok(
        homeAt < headerHtml.indexOf('aria-label="Open sidebar"'),
        'home must lead the action group, not trail it'
      );
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

  it('opens on the launch pad: every cloud target, its briefing, and one start control', async () => {
    const { json: list } = await get(base, '/api/scenarios');

    const idle = render('LaunchPad', {
      scenarios: list.scenarios,
      selectedScenarioId: null,
      onSelect: noop,
      onStart: noop,
    });
    // One card per pack, and each card carries real pack-derived briefing data.
    assert.equal((idle.match(/class="launch-card /g) ?? []).length, list.scenarios.length);
    assert.match(idle, /Choose a cloud to attack/);
    assert.match(idle, /Recommended first run/);
    assert.match(idle, /Bucket Policy Made Public/, 'nothing locked must spotlight a target, not sit empty');
    // The inventory totals must equal what the API actually reported.
    const totals = list.scenarios.reduce(
      (sum, pack) => ({
        events: sum.events + pack.event_count,
        workflows: sum.workflows + pack.workflow_count,
        fixes: sum.fixes + pack.candidate_count,
      }),
      { events: 0, workflows: 0, fixes: 0 }
    );
    for (const value of Object.values(totals)) {
      assert.ok(idle.includes(`>${value}<`), `inventory total ${value} missing from the pad`);
    }
    // A briefing glyph per card, plus the spotlight map.
    assert.equal((idle.match(/class="launch-glyph[ "]/g) ?? []).length, list.scenarios.length + 1);
    // Nothing locked => the big control offers the recommendation, and the
    // spotlight's own launch button is available.
    assert.match(idle, /Start on Bucket Policy Made Public/);
    assert.match(idle, /Filter by service, action, resource/);
    assert.equal((idle.match(/class="launch__scope"/g) ?? []).length, 3, 'three inactive scope chips');
    assert.match(idle, /class="launch__scope launch__scope--active"[^>]*aria-pressed="true"/, 'active scope must say so');

    const armed = render('LaunchPad', {
      scenarios: list.scenarios,
      selectedScenarioId: 'compromised-role',
      onSelect: noop,
      onStart: noop,
    });
    assert.match(armed, /Target locked —/);
    assert.match(armed, /<strong>Compromised Developer Role<\/strong>/);
    assert.match(armed, /Start attack/);
    assert.match(armed, /Locked target/);
    assert.ok(!/class="launch__start"[^>]*disabled=""/.test(armed), 'start must be enabled once a target is locked');
    assert.match(armed, /launch-card--selected/);
    for (const scenario of list.scenarios) {
      assert.ok(armed.includes(scenario.name), `${scenario.scenario_id} missing from the launch pad`);
    }
  });

  it('briefings describe the pack without leaking the answer key', async () => {
    const { json: list } = await get(base, '/api/scenarios');

    const html = render('LaunchPad', {
      scenarios: list.scenarios,
      selectedScenarioId: null,
      onSelect: noop,
      onStart: noop,
      formatTimestamp,
    });
    // The pad must not pre-answer what the twin is about to determine.
    const rendered = unescapeHtml(html);
    for (const forbidden of ['ground_truth', 'expected_broad_remediation_status', 'expected_narrow_remediation_status']) {
      assert.ok(!rendered.includes(forbidden), `launch pad leaked ${forbidden}`);
    }
    // No placeholder mush either: every briefing slot resolves to real data.
    assert.ok(!/NaN|undefined/.test(html), 'briefing printed NaN/undefined');
    assert.match(html, /launch__fact/, 'the spotlight must show pack facts');
    // Sensitive-data flags come from the packs, and at least one has them.
    const sensitive = list.scenarios.filter((pack) => (pack.briefing?.sensitive_resources ?? 0) > 0);
    assert.ok(sensitive.length > 0, 'expected some pack to expose sensitive resources');
    assert.match(html, /sensitive/);
  });

  it('filters and scopes are pure functions over the same data the UI uses', async () => {
    const { json: list } = await get(base, '/api/scenarios');
    const all = list.scenarios;

    assert.equal(filterLaunchTargets(all, { query: '', scope: 'all' }).length, all.length);
    assert.equal(filterLaunchTargets(all, { query: '', scope: 'attack' }).length, 7);
    assert.equal(filterLaunchTargets(all, { query: '', scope: 'benign' }).length, 5);
    assert.ok(filterLaunchTargets(all, { query: '', scope: 'sensitive' }).length > 0);

    // Searching by a service named in a briefing finds its packs.
    const pack = all.find((candidate) => (candidate.briefing?.services ?? []).includes('secretsmanager'));
    assert.ok(pack, 'expected a pack touching secretsmanager');
    assert.ok(filterLaunchTargets(all, { query: 'secretsmanager', scope: 'all' }).some((hit) => hit.scenario_id === pack.scenario_id));

    // And a query that matches nothing yields nothing, rather than everything.
    assert.equal(filterLaunchTargets(all, { query: 'definitely-not-a-service', scope: 'all' }).length, 0);
    // Hostile inputs must not throw.
    assert.deepEqual(filterLaunchTargets(null, { query: 'x', scope: 'attack' }), []);
    assert.equal(filterLaunchTargets(all, { query: '', scope: 'nonsense' }).length, all.length, 'unknown scope must fall through to everything');
    // A literal asterisk is a character, not a glob: no pack is named "*".
    assert.equal(filterLaunchTargets(all, { query: '*', scope: 'all' }).length, 0);
  });

  it('explains an unreachable pack instead of showing an empty grid', () => {
    const blocked = render('LaunchPad', {
      scenarios: [],
      selectedScenarioId: null,
      onSelect: noop,
      onStart: noop,
      unavailable: true,
      apiBase: '/api',
      onReload: noop,
    });
    assert.match(blocked, /No targets loaded/);
    assert.match(blocked, /Reload scenarios/);
    assert.match(blocked, /role="alert"/, 'a failed pack must be announced, not decorative');
    assert.ok(!blocked.includes('launch-card'), 'no target cards when there are no targets');

    const emptyPack = render('LaunchPad', {
      scenarios: [],
      selectedScenarioId: null,
      onSelect: noop,
      onStart: noop,
      empty: true,
      onReload: noop,
    });
    assert.match(emptyPack, /BREACHLOOP_SCENARIOS_DIR|pack is empty/);
  });

  it('keeps launch-pad motion inside the reduced-motion contract', () => {
    const css = fs.readFileSync(path.join(ROOT, 'styles', 'index.css'), 'utf8');
    const reduced = reducedMotionBlocks(css).join('\n');
    // Staggered entrances and the dash-flow both use animation-delay; the global
    // block only zeroes duration, so the pad must zero delays or cards pop in.
    assert.match(reduced, /animation-delay: 0ms !important/);
    assert.ok(reduced.includes('.launch-glyph__link'), 'looping edge flow must stop under reduced motion');
    assert.match(css, /@keyframes launch-sweep/);
    const html = render('LaunchPad', {
      scenarios: [{ scenario_id: 'x', name: 'X', description: 'd', scenario_type: 'attack', event_count: 1, workflow_count: 0, candidate_count: 1 }],
      selectedScenarioId: null,
      onSelect: noop,
      onStart: noop,
    });
    assert.match(html, /animation-delay:0ms/, 'stagger delay is inline per card');
    // A pack with no briefing must still render, glyph and all.
    assert.match(html, /launch-glyph__empty|launch-glyph/);
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
      (() => {
        const bare = render('Header', { scenario: undefined, providerMode: 'anthropic', onProviderChange: noop, onRunIncident: noop, onRunBenchmark: noop, onDownloadReport: noop, onToggleSidebar: noop, isRunning: true, hasReport: false, sidebarOpen: true });
        assert.ok(!bare.includes('header__home'), 'home must only render when a handler exists to act on it');
      })();
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

describe('aws identifiers and the ambient field', () => {
  const ARNS = {
    role: 'arn:aws:iam::123456789012:role/acme-payroll-analytics',
    bucket: 'arn:aws:s3:::acme-payroll-us',
    secret: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/db-Abcd12',
    key: 'arn:aws:kms:us-east-1:123456789012:key/1111aaaa-2222-bbbb-3333-cccc4444dddd',
    snapshot: 'arn:aws:rds:us-east-1:123456789012:snapshot:prod-db-2026-08-22',
  };

  it('links every service to the matching AWS documentation', () => {
    const expected = {
      role: '/IAM/latest/UserGuide/id_roles.html',
      bucket: '/AmazonS3/latest/userguide/bucket-policies.html',
      secret: '/secretsmanager/latest/userguide/intro.html',
      key: '/kms/latest/developerguide/overview.html',
      snapshot: '/AmazonRDS/latest/UserGuide/USER_ShareSnapshot.html',
    };
    for (const [name, arn] of Object.entries(ARNS)) {
      const html = render('AwsRef', { value: arn });
      assert.match(html, new RegExp(`href="https://docs\\.aws\\.amazon\\.com${expected[name].replace(/[/.]/g, '\\$&')}"`), `${name}: wrong doc target`);
      assert.match(html, /target="_blank"/, `${name}: external links open in a tab`);
      assert.match(html, /rel="noopener noreferrer"/, `${name}: external link must not leak the opener`);
    }
  });

  it('never links into the AWS console, because nothing exists there', () => {
    for (const arn of Object.values(ARNS)) {
      const html = render('AwsRef', { value: arn });
      assert.ok(!html.includes('console.aws.amazon.com'), `${arn} must not point at the console`);
      // The disclaimer travels with the identifier, not just with the page.
      assert.match(html, /synthetic scenario pack/);
      assert.match(html, /Opens AWS documentation, not the AWS console/);
    }
  });

  it('routes the account id to AWS account-identifier docs and labels it synthetic', () => {
    const html = render('AwsRef', { value: '123456789012', label: '123456789012' });
    assert.match(html, /href="https:\/\/docs\.aws\.amazon\.com\/accounts\/latest\/reference\/manage-acct-identifiers\.html"/);
    assert.match(html, /example account AWS uses in its own documentation/);
  });

  it('falls back to the ARN reference for services with no curated page', () => {
    assert.equal(awsDocFor('arn:aws:sqs:us-east-1:123456789012:queue').href.includes('aws-arns-and-namespaces'), true);
    // A bare name is only resolvable with a hint; without one it still lands somewhere valid.
    assert.equal(awsDocFor('acme-nightly-runner', 'lambda').label, 'Lambda documentation');
    assert.equal(awsDocFor('not-an-arn').href, 'https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html');
  });

  it('infers the service from a bare parameter name', () => {
    assert.equal(serviceHintFromKey('bucket_name'), 's3');
    assert.equal(serviceHintFromKey('denied_principal_arn'), 'iam');
    assert.equal(serviceHintFromKey('db_snapshot_identifier'), 'rds');
    assert.equal(serviceHintFromKey('note'), undefined, 'a non-resource key must not be guessed');
  });

  it('links the exact resource a remediation would touch', async () => {
    const { json: list } = await get(base, '/api/scenarios');
    const summary = list.scenarios.find(item => item.scenario_type === 'attack') ?? list.scenarios[0];
    const lab = render('RemediationLab', propsFor(await viewFor(summary.scenario_id)).RemediationLab);
    assert.ok(lab.includes('class="awsref"') || lab.includes('awsref"'), 'parameters must stay inspectable');
    for (const href of lab.match(/href="[^"]*"/g) ?? []) {
      assert.ok(href.includes('https://docs.aws.amazon.com/'), `unexpected remediation link: ${href}`);
    }
  });

  it('survives the shapes that used to blank panels', () => {
    assert.equal(shortArn(undefined), '—');
    assert.equal(shortArn(''), '—');
    assert.equal(shortArn('arn:aws:iam::123456789012:role/acme-payroll'), 'acme-payroll');
    assert.equal(shortArn('plain'), 'plain');
    for (const value of [undefined, null, '', 0, {}, []]) {
      assert.doesNotThrow(() => render('AwsRef', { value }), `AwsRef(${JSON.stringify(value)}) threw`);
    }
  });

  it('renders identifiers as links in the live incident views', async () => {
    const { json: list } = await get(base, '/api/scenarios');
    const summary = list.scenarios.find(item => item.scenario_type === 'attack') ?? list.scenarios[0];
    const view = await viewFor(summary.scenario_id);

    const timeline = render('EventTimeline', propsFor(view).EventTimeline);
    assert.match(timeline, /class="awsref"/, 'event actors must be inspectable');
    assert.ok(!timeline.includes('console.aws.amazon.com'), 'timeline must not offer a console link');

    const header = render('Header', {
      scenario: summary,
      providerMode: 'deterministic',
      onProviderChange: noop,
      onRunIncident: noop,
      onRunBenchmark: noop,
      onDownloadReport: noop,
      onToggleSidebar: noop,
      onHome: noop,
      accountIds: ['123456789012'],
      isRunning: false,
      hasReport: true,
      sidebarOpen: false,
    });
    assert.match(header, /header__account-value--synthetic/, 'the placeholder account must not read like a live one');
    assert.match(header, /manage-acct-identifiers/);
  });

  it('keeps the ambient field decorative, looped, and switchable', () => {
    const html = render('DynamicBackground', {});
    assert.match(html, /class="bg-field" aria-hidden="true"/, 'the field must be hidden from assistive tech');
    assert.match(html, /class="dynamic-background"/);
    assert.match(html, /bg-field__grid[\s"]/);
    assert.match(html, /bg-field__beam[\s"]/);

    const css = fs.readFileSync(path.join(ROOT, 'styles', 'index.css'), 'utf8');
    for (const name of ['bg-grid-drift', 'bg-beam-travel']) {
      assert.ok(css.includes(`@keyframes ${name}`), `${name} keyframes missing`);
      assert.ok(css.includes(`animation: ${name}`), `${name} is declared but never applied`);
    }
    // The app-wide reduced-motion contract: both loops stopped outright (a
    // zero-duration infinite animation still re-runs on delay), the button sheen
    // removed rather than snapped, and the timing tokens flattened at :root.
    const reduced = reducedMotionBlocks(css).join('\n');
    assert.match(reduced, /\.bg-field__grid,[\s\S]{0,40}animation: none;/);
    assert.match(reduced, /\.bg-field__beam[\s\S]{0,60}opacity: 0\.4;/);
    assert.match(reduced, /\.btn:not\(\.btn--primary\)::after[\s\S]{0,120}display: none;/);
    assert.match(css, /--motion-fast: 0ms;/);
  });
});
