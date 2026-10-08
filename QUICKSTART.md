# BreachLoop — five-minute tour

## 1. Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

No `.env`, no Python, no second process. If you want the production path: `npm run build && npm run start`.

## 2. Click around

1. The console opens on the **launch pad**: every pack in the loaded cloud inventory is a card with its real
   pre-run briefing — services touched, CloudTrail window, identities, sensitive resources — drawn over a live
   topology map. A **recommended first run** is spotlighted, so `Enter` launches immediately; or search
   (`secretsmanager`, `kms`, `snapshot`…), filter by scope, and press **Start attack**. `↑`/`↓` walk targets,
   double-click a card to launch it directly, `/` focuses search, `Esc` clears it. The **Home** button in the
   header returns to this screen from an analysis (it clears the current incident view; nothing is deleted —
   the twin re-runs deterministically).
2. The **hypothesis bar** states the attacker's entry point, the objective, and a confidence score. Selecting a
   different target in the sidebar returns you to the launch pad with that target already locked.
3. The **graph** pulses on the compromised principal and the targeted resource; red edges are the attack path,
   blue edges are benign business workflows.
4. The **timeline** holds the CloudTrail events behind that path — toggle "attack path only" and expand an event
   to see its raw evidence.
5. Open the **Remediation Lab** and simulate both scopes of a candidate:
   - *broad* (`revoke_role_sessions`) → usually **rejected**: it breaks payroll/ETL workflows
   - *narrow* (scoped deny) → **verified**: attacker blocked, workflows intact
6. Hit **Benchmark** in the header for the 12-scenario scorecard. Read the disclaimer: it is a digital twin,
   not AWS.

## 3. Poke the API directly

```bash
curl localhost:3000/api/health | jq
curl localhost:3000/api/scenarios | jq '.scenarios[].scenario_id'
curl -s localhost:3000/api/scenarios/bucket-policy-tamper | jq '.candidate_remediations[].id'

# the analysis itself lives on the run, not on the pack
curl -sX POST localhost:3000/api/incidents/run \
     -H 'content-type: application/json' \
     -d '{"scenario_id":"sts-pivot-exfil"}' | jq '.report.hypothesis, .report.attack_path.steps'

# re-simulate one candidate against a stored run
RUN=$(curl -s -X POST localhost:3000/api/incidents/run -H 'content-type: application/json' \
        -d '{"scenario_id":"bucket-policy-tamper"}' | jq -r .run_id)
curl -sX POST localhost:3000/api/incidents/$RUN/simulate -H 'content-type: application/json' \
     -d '{"remediation_id":"fix-broad-01","scope":"broad"}' | jq '{status, reason}'

curl -sX POST localhost:3000/api/benchmark/run | jq '{accuracy_percentage, synthetic}'
curl -s "localhost:3000/api/reports/$RUN?format=csv" | head -2
```

## 4. Check yourself

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # clean: no warnings, no errors
npm run test:e2e    # build, then boot two real `next start` servers and drive them
npm run verify      # typecheck -> build -> test, the whole gate from a clean clone
```

`npm test` (and `test:e2e`) cover the failure modes that used to break deploys: read-only filesystem, missing/corrupt scenario
pack, cold start, malformed payloads reaching the UI. The hostile half of the suite deliberately points
`BREACHLOOP_SCENARIOS_DIR` and `BREACHLOOP_DB_PATH` at broken paths and asserts the app degrades instead of
hanging or 500-ing.

## 5. Optional: the Python reference

`backend/` is the original FastAPI implementation, kept as the parity oracle for `lib/engine/`. The app never needs
it, but you can run both and diff them:

```bash
npm run reference:install
npm run reference:test          # pytest
npm run dev:with-reference      # Next on :3000, uvicorn on :8000
```

## Where things live

| Want to… | Look in |
| --- | --- |
| change the UI shell | `components/SocConsole.tsx` |
| change an analysis rule | `lib/engine/` (`graph.ts`, `analyst.ts`, `twin.ts`, `simulation.ts`) |
| add a scenario | `scenarios/*.json` (schema in `lib/engine/scenarioSchema.ts`) |
| change an endpoint | `app/api/**/route.ts` |
| change the theme | `styles/index.css` |
| see what's configurable | `.env.example` (every variable optional) |

## Gotchas

- The UI degrades on purpose. A missing pack or unwritable disk sets `degraded: true` and notes rather than
  throwing — check `/api/health` before debugging a "wrong" number.
- `AttackGraph` injects a `<style>` block and components use inline styles, so a strict nonce CSP will break the
  page.
- Reports are synthetic: `synthetic: true` is on every report, and the benchmark prints
  `SYNTHETIC BENCHMARK RESULTS ONLY`.
