# BreachLoop — AI-Assisted Cloud Incident-Response Simulator

A cinematic SOC console that ingests synthetic CloudTrail events, reconstructs the attack path, proposes
remediations, and tests every fix against an in-process digital twin before anything is called *verified*.

One deployable unit. Next.js 15 App Router serves both the UI and the API, and the engine that used to live in
a separate FastAPI process is now TypeScript in `lib/engine/`. `npm install && npm run dev` is the entire setup —
no `.env`, no Python, no companion process, no CORS hop.

## The claim it earns

Broad fixes (revoke all role sessions) and narrow fixes (scoped deny) both look like wins on a reachability
dashboard. BreachLoop shows the difference: the broad fix blocks the attacker **and** breaks payroll, while the
narrow fix blocks the attacker and preserves the workflow. Every candidate is simulated against cloned state, so
`verified` means "verified against the twin" — never "verified against AWS".

## Key features

- **Digital-twin validation** — each remediation is applied to a cloned graph and re-analysed; status is
  `verified` / `rejected` / `unverified` with the reason it earned.
- **Attack-path reconstruction** — BFS over trust + permission edges, with per-step evidence pointing back at a
  real event id.
- **Interactive SVG graph** — compromise → escalation → exfiltration, with attack edges and benign workflow edges
  drawn separately and node highlighting for the entry point and target.
- **Audit timeline** — CloudTrail events, filterable, attack-path events highlighted, raw evidence inspectable.
- **Workflow health matrix** — which business-critical workflows survive which fix.
- **Launch pad** — the console opens on the loaded cloud inventory instead of an empty panel. Every pack is a
  card carrying its real pre-run briefing (services touched, CloudTrail window, identities, sensitive and
  publicly-exposed resources, workflow criticality) over a live micro-topology map; a spotlight arms a
  recommended first run; search, scope chips and `↑ ↓ Enter / Esc` cover picking a target by keyboard. Expected
  remediation verdicts are deliberately **not** shown — the pad previews scope, not the answer key.
- **Inspectable identifiers** — every ARN, account ID and remediation parameter that names a resource is a
  link to the matching AWS documentation page (IAM roles, S3 bucket policies, snapshot sharing, IMDS…). It
  deliberately does **not** link into the AWS console: these resources exist only in a scenario pack, and a
  working-looking console link is precisely what would let simulated data pass for live infrastructure. The
  header also states which account the incident was reconstructed inside, tinted as synthetic.
- **Trainer mode** — the same packs as one-question-per-pack drills: the preview carries the evidence and the
  candidate fixes by name, and *nothing* that betrays the verdict. Commit, and the twin's real status, the
  workflows each fix breaks and the pack's answer key are revealed together. Benign packs add a "no change"
  option and are graded on scenario type — applying a control to legitimate activity is wrong even when the
  control would verify. Score is kept in `localStorage`, not on the server, so the API stays stateless.
- **12-scenario benchmark** — 7 attack, 5 benign, ground-truth labelled, with a synthetic-scorecard modal.
- **100% synthetic and offline** — no cloud credentials, no runtime egress, no provider required. The app never
  fetches anything outside `/api`; the only outbound navigation is a link the user clicks in their own browser.

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

Production:

```bash
npm run build
npm run start          # http://localhost:3000
```

Verify everything (typecheck → tests → build):

```bash
npm run verify
```

Nothing needs configuring. If `ANTHROPIC_API_KEY` is absent the analyst stays deterministic and says so in the
payload (`provider_mode: "deterministic"`) instead of failing.

## Layout

```
breachloop-app/
├── app/
│   ├── layout.tsx, page.tsx        # console shell
│   └── api/                        # route handlers = the whole "backend"
├── components/                     # 14 presentational components (SocConsole is the root)
├── lib/
│   ├── api/                        # client, base-URL resolver, retrying fetch, serializers, respond helpers
│   ├── engine/                     # ported engine: normalizer, graph, analyst, twin, simulation, runStore,
│   │                               #   scenarioStore + schema, provider, fallback
│   └── types.ts                    # single public type surface for the UI
├── scenarios/                      # 12 synthetic scenario packs (the "dataset")
├── styles/index.css                # ember/Glass SOC theme
├── tests/                          # node:test end-to-end suites (real `next start`)
├── backend/                        # Python reference implementation + pytest — optional parity oracle
└── vercel.json                     # zero-config deploy
```

## HTTP API

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | readiness + capability report, including `persistence.writable` and active degradations |
| `GET` | `/api/scenarios` | summaries plus a per-pack `briefing` (services, event window, identity and resource counts, a bounded topology glyph) — never `ground_truth` |
| `GET` | `/api/scenarios/{id}` | the pack itself — events, topology sections, candidates, ground truth |
| `POST` | `/api/incidents/run` | `{ "scenario_id": "…" }` → `{ run_id, report, scenario_detail }`, report inline (works where disk is read-only) |
| `GET` | `/api/incidents/{runId}` | stored run |
| `GET` | `/api/incidents/{runId}/report` | stored report, recomputed from the pack if the run only survives in memory |
| `POST` | `/api/incidents/{runId}/simulate` | `{ "remediation_id": "…", "scope": "broad"\|"narrow" }` |
| `POST` | `/api/quiz/preview` | `{ "scenario_id": "…" }` (or `?scenario_id=`) — trainer view: hypothesis, path, events, workflows, candidate titles; **no** twin status, no candidate description, no `is_broad`, no `ground_truth` |
| `POST` | `/api/quiz/grade` | `{ "scenario_id": "…", "option_id": "…" }` — after the learner commits: twin verdicts for every candidate, the pack's expected labels, and `graded: false` when the attempt could not be scored |
| `GET` | `/api/quiz` | which packs are playable in the trainer, and how many options each has |
| `POST` \| `GET` | `/api/benchmark/run` | synthetic scorecard + disclaimer |
| `GET` | `/api/reports`, `/api/reports/{runId}` | evidence reports, `?format=jsonl\|csv` and `?download=1` |

Requests never fail with a bare 500: a missing pack, a corrupt file or an unwritable disk downgrades the response
(`degraded: true` + `degradation_notes`) while still returning a usable report. Contract errors are still contract
errors — `400` for a missing `scenario_id`, `404` for an unknown scenario.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `start` | `next dev` / `next start`, bound to `0.0.0.0:${PORT:-3000}` |
| `npm run build` | production build; scenario packs are traced into every API bundle |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | end-to-end suites against two live `next start` servers — needs `.next/`, so build first |
| `npm run test:e2e` | `next build` followed by `npm test`, i.e. the suites with their prerequisite |
| `npm run verify` | the whole gate from a clean checkout: typecheck → build → test |
| `npm run reference:install\|serve\|test` | the optional Python reference implementation |
| `npm run dev:with-reference` | Next dev server + uvicorn side by side (parity debugging) |

## Configuration (all optional)

| Variable | Default | Why you'd set it |
| --- | --- | --- |
| `PORT` | `3000` | dev/start port |
| `NEXT_PUBLIC_API_BASE_URL` | *unset → relative `/api`* | only if you host the API elsewhere |
| `BREACHLOOP_SCENARIOS_DIR` | `./scenarios` | external pack directory; the bundled pack always backstops it |
| `BREACHLOOP_DB_PATH` | `os.tmpdir()/breachloop-runs.json` | run-store file; best-effort only |
| `BREACHLOOP_DISABLE_PERSISTENCE` | `0` | `1` = pure in-memory (serverless-friendly) |
| `BREACHLOOP_PROVIDER` | `deterministic` | `anthropic` is opt-in and needs a key |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | — | live analyst, never required |
| `BREACHLOOP_API_CORS_ORIGIN` | — | extra origin for a separately hosted frontend |
| `NEXT_OUTPUT` | — | `standalone` for container images (off by default) |

`.env.example` documents the same set. Copying it is optional; a zero-config boot is the contract.

## Tests

`npm test` boots two real production servers, because every defect this project has hit was an integration defect
that unit tests cannot see:

- **`tests/api.test.mjs`** — healthy instance: health, static shell, all 12 scenarios, run/report/simulate, export
  formats, benchmark, error contracts. Hostile instance (`BREACHLOOP_SCENARIOS_DIR` pointing at a corrupt pack,
  `BREACHLOOP_DB_PATH=/proc/nope/…`): degradation flags, notes, and the event loop staying responsive under load.
- **`tests/render.test.mjs`** — bundles the real components with esbuild and `renderToString`s them against live
  API payloads for all 12 scenarios, then against hand-built hostile payloads (null arrays, `NaN` coordinates,
  unparseable timestamps, missing fields). The attack graph must draw exactly one node per distinct ARN; the
  scorecard must print every degradation note and never leak `NaN`.

Both suites boot real servers (31 tests today), so `npm test` needs a build; `npm run test:e2e` does the build for you, and
`npm run verify` is ordered typecheck → build → test so it works on a fresh clone.

There is no headless browser available in this environment (no Playwright binary, and its browser CDN is not
reachable), so "UI verification" here means server-rendered markup of the actual components — not a screenshot.

## Parity with the Python reference

`backend/` still holds the original FastAPI implementation, kept as the engine's behavioural oracle:

```bash
npm run reference:install && npm run reference:test
```

Field-by-field comparison of `attack_path`, `hypothesis`, `simulations[]` and workflow state across all 12
scenarios: **0 mismatches**, benchmark `12/12`, accuracy `100.0%`. Deliberately preserved quirks (they are the
specification, not bugs): a globally shared BFS `visited` set marked at enqueue so the first hit wins; confidence
`0.7 + min(0.2, observed_steps × 0.05) + 0.1` for an `AssumeRole` in the path `− 0.15` when an evidenced event is
unsupported, clamped to `[0,1]`; `observed_steps` counting every step except `evidence_event_id == "topology"`.

## Look and feel

Graphite canvas (`#0b0d12`) with warm frosted-glass panels and an ember accent set carrying the status semantics:
primary `#ff8a3d`, critical `#f05252`, warning `#eab65d`, verified `#43c6a0`, info `#92a8c7`. Motion is
deliberate — animated attack-path flow, pulse rings on compromised and target nodes, staged panel entrances.
`prefers-reduced-motion: reduce` is honored in both places it could leak: the CSS token scale drops to `0ms` and
flattens keyframes, and each of the three JS-driven loops (`AttackGraph` reveal, `DynamicBackground`,
`MagneticCursor`) checks the media query and renders the final state instead.

## Known limits (stated plainly)

- **Synthetic only.** Reports carry `synthetic: true` and warnings; the benchmark prints
  `SYNTHETIC BENCHMARK RESULTS ONLY`. This is a twin, not an authorization oracle.
- **No strict CSP.** Components use inline styles and `AttackGraph` injects a `<style>` block for its keyframes, so
  a nonce-based CSP would need those extracted first. Security headers that are set: `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **Fonts load from a `<link>`, not `next/font`.** `next/font` wants the network at build time; builds must be
  hermetic and offline, so the stack degrades to system fonts.
- **Run persistence is best-effort.** On a read-only filesystem the store stays in memory and `/api/health` reports
  `persistence.writable: false`. `full_report` is not written to disk, so disk-hydrated runs recompute.
- **Linting is opt-in.** `next build` sets `eslint.ignoreDuringBuilds`, so run
  `npm run lint` explicitly (it is clean today: no warnings, no errors).

---

Built for security-engineering education and portfolio demonstration. See `SECURITY.md` for the disclosure policy
and `QUICKSTART.md` for the five-minute tour.
