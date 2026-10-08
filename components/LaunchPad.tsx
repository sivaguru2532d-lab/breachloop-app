/**
 * LaunchPad — what the analyst sees before any run, instead of a dead
 * "Ready to Analyze" panel.
 *
 * It answers the two questions an empty console actually poses: *what can I
 * point this at*, and *how do I start*. Every scenario pack in the loaded cloud
 * inventory is a target with its real briefing attached (services touched,
 * event window, identity and resource counts, the topology it will be traced
 * over), and one control launches the run.
 *
 * Deliberately *not* shown here: `ground_truth` verdicts. The expected
 * remediation outcome is what the twin is about to determine; printing it on a
 * card would turn the exercise into an answer key.
 *
 * Motion rules: entrance staggers, the radar sweep, edge dash-flow and the
 * standby pulse are pure CSS, so the `prefers-reduced-motion` block in
 * styles/index.css flattens them — and this pad zeroes its own animation
 * delays, which that global block leaves alone. No requestAnimationFrame here.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Crosshair,
  Database,
  KeyRound,
  Loader2,
  Play,
  Radar,
  RotateCw,
  Search,
  ShieldCheck,
  Workflow,
  X,
} from 'lucide-react';
import { filterLaunchTargets, type LaunchFilterState } from '@/lib/api/briefing';
import type { LaunchBriefing, LaunchGlyphNode, LaunchNodeKind, ScenarioSummary } from '@/lib/types';

interface LaunchPadProps {
  scenarios: ScenarioSummary[];
  selectedScenarioId: string | null;
  onSelect: (scenarioId: string) => void;
  /** Optional id so a double-click can launch a target that is not yet locked. */
  onStart: (scenarioId?: string) => void;
  isRunning?: boolean;
  /** The API could not be reached at all. */
  unavailable?: boolean;
  /** The API answered, but delivered no packs. */
  empty?: boolean;
  apiBase?: string;
  /** 'trainer' rewords the call to action: the same click opens a question, not an analysis. */
  mode?: 'analyze' | 'trainer';
  onReload?: () => void;
  formatTimestamp?: (iso: string) => string;
  className?: string;
}

const KIND_ORDER: LaunchNodeKind[] = ['principal', 'role', 'workload', 'resource'];

const KIND_COLOR: Record<LaunchNodeKind, string> = {
  principal: 'var(--accent-critical)',
  role: 'var(--accent-warning)',
  workload: 'var(--accent-purple)',
  resource: 'var(--accent-info)',
};

const SCOPES: { id: LaunchFilterState['scope']; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'attack', label: 'Attack' },
  { id: 'benign', label: 'Benign' },
  { id: 'sensitive', label: 'Sensitive data' },
];

function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function spanLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'single point';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr`;
  return `${Math.round(minutes / 1440)} days`;
}

export function LaunchPad({
  scenarios,
  selectedScenarioId,
  onSelect,
  onStart,
  isRunning = false,
  unavailable = false,
  empty = false,
  apiBase = '/api',
  mode = 'analyze',
  onReload,
  formatTimestamp = (iso) => iso,
  className = '',
}: LaunchPadProps) {
  const packs = useMemo(() => (Array.isArray(scenarios) ? scenarios : []), [scenarios]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<LaunchFilterState['scope']>('all');
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => filterLaunchTargets(packs, { query, scope }), [packs, query, scope]);
  const attackCount = packs.filter((pack) => pack?.scenario_type === 'attack').length;
  const selected = packs.find((pack) => pack?.scenario_id === selectedScenarioId) ?? null;
  // Nothing locked yet ⇒ spotlight the first attack pack as the recommended
  // first run, so the pad opens armed instead of waiting on a choice.
  const spotlight = selected ?? visible.find((pack) => pack?.scenario_type === 'attack') ?? visible[0] ?? null;
  const canStart = Boolean(spotlight) && !isRunning;

  const totals = useMemo(
    () =>
      visible.reduce(
        (accumulator, pack) => {
          accumulator.events += pack?.event_count ?? 0;
          accumulator.workflows += pack?.workflow_count ?? 0;
          accumulator.fixes += pack?.candidate_count ?? 0;
          return accumulator;
        },
        { events: 0, workflows: 0, fixes: 0 }
      ),
    [visible]
  );
  const busiest = visible.reduce((max, pack) => Math.max(max, pack?.event_count ?? 0), 0);

  const step = useCallback(
    (direction: number) => {
      if (visible.length === 0) return;
      const current = visible.findIndex((pack) => pack.scenario_id === spotlight?.scenario_id);
      const next = current < 0 ? 0 : (current + direction + visible.length) % visible.length;
      const target = visible[next];
      if (target) onSelect(target.scenario_id);
    },
    [visible, spotlight, onSelect]
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const typing = (event.target as HTMLElement | null)?.tagName === 'INPUT';

    if (event.key === '/' && !typing) {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (event.key === 'Escape') {
      if (query) {
        setQuery('');
        searchRef.current?.blur();
      }
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      step(1);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      step(-1);
      return;
    }
    if (event.key === 'Enter' && !typing) {
      event.preventDefault();
      if (spotlight) onStart(spotlight.scenario_id);
      return;
    }
    if (event.key === 'Enter' && typing) {
      // Search then Enter is the fastest path to a run: launch the top match.
      event.preventDefault();
      const best = visible[0] ?? spotlight;
      if (best) {
        onSelect(best.scenario_id);
        onStart(best.scenario_id);
      }
    }
  };

  // A pack that never arrived must stay explainable — the launch pad is not a
  // place to hide a failure behind a pretty grid of nothing.
  if (unavailable || empty) {
    return (
      <section className={`launch launch--blocked ${className}`} role="alert" aria-label="Scenario pack unavailable">
        <div className="launch__blocked-icon">
          <Radar size={40} />
        </div>
        <p className="launch__eyebrow">Cloud inventory</p>
        <h1 className="launch__title">No targets loaded</h1>
        <p className="launch__lede">
          {unavailable
            ? `The console could not reach ${apiBase}, so there is nothing to attack yet. The interface stays usable — reload when the API answers.`
            : 'The API responded, but the pack is empty. Add scenario JSON to scenarios/ or point BREACHLOOP_SCENARIOS_DIR at a directory of packs.'}
        </p>
        {onReload && (
          <button type="button" className="btn btn--secondary" onClick={onReload}>
            <RotateCw size={14} /> Reload scenarios
          </button>
        )}
      </section>
    );
  }

  return (
    <section
      className={`launch ${className}`}
      aria-label="Threat simulation launch pad"
      onKeyDown={onKeyDown}
      data-visible-targets={visible.length}
    >
      <div className="launch__radar" aria-hidden="true">
        <span />
      </div>

      <header className="launch__header">
        <div className="launch__heading">
          <p className="launch__eyebrow">
            <Radar size={12} aria-hidden="true" /> Cloud digital twin · {packs.length} environment
            {packs.length === 1 ? '' : 's'} armed
          </p>
          <h1 className="launch__title">Choose a cloud to attack</h1>
          <p className="launch__lede">
            Every target below is a synthetic AWS account — CloudTrail events, an IAM graph, live business
            workflows. Pick one and the twin reconstructs the attack path, then proves each fix against it.
          </p>
        </div>

        <div className="launch__controls">
          <div className="launch__search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              className="launch__search-input"
              placeholder="Filter by service, action, resource…  ( / )"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Filter targets"
            />
            {query && (
              <button type="button" className="launch__search-clear" onClick={() => setQuery('')} aria-label="Clear filter">
                <X size={12} />
              </button>
            )}
          </div>
          <div className="launch__scopes" role="group" aria-label="Target scope">
            {SCOPES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`launch__scope${scope === option.id ? ' launch__scope--active' : ''}`}
                onClick={() => setScope(option.id)}
                aria-pressed={scope === option.id}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="launch__totals" role="group" aria-label="Visible inventory">
        <LaunchTotal label="Targets" value={visible.length} detail={`${attackCount} attack`} />
        <LaunchTotal label="CloudTrail events" value={totals.events} detail="to reconstruct" />
        <LaunchTotal label="Workflows" value={totals.workflows} detail="at risk" />
        <LaunchTotal label="Fix candidates" value={totals.fixes} detail="to simulate" />
        {visible.length !== packs.length && (
          <p className="launch__filter-note">
            filtered {visible.length} of {packs.length}
          </p>
        )}
      </div>

      {spotlight && <LaunchSpotlight pack={spotlight} isLocked={Boolean(selected)} onStart={onStart} isRunning={isRunning} formatTimestamp={formatTimestamp} />}

      {visible.length === 0 ? (
        <div className="launch__none" role="status">
          <Search size={18} aria-hidden="true" />
          <p>
            No target matches “{query}”
            {scope !== 'all' ? ` in ${scope} scope` : ''}.
          </p>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setQuery('');
              setScope('all');
            }}
          >
            <RotateCw size={12} /> Reset filters
          </button>
        </div>
      ) : (
        <div className="launch__grid">
          {visible.map((pack) => (
            <TargetCard
              key={pack.scenario_id}
              pack={pack}
              index={packs.indexOf(pack)}
              busiest={busiest}
              selected={pack.scenario_id === spotlight?.scenario_id}
              onSelect={onSelect}
              onStart={onStart}
            />
          ))}
        </div>
      )}

      <footer className="launch__console">
        <div className="launch__console-left">
          <p className="launch__status" role="status">
            {isRunning ? (
              <>
                <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Reconstructing the attack path…
              </>
            ) : selected ? (
              <>
                <Crosshair size={13} aria-hidden="true" /> Target locked — <strong>{selected.name}</strong>
              </>
            ) : (
              <>
                <ShieldCheck size={13} aria-hidden="true" /> Recommended first run —{' '}
                <strong>{spotlight?.name ?? 'none'}</strong>
              </>
            )}
          </p>
          <p className="launch__keys" aria-hidden="true">
            <kbd>↑</kbd>
            <kbd>↓</kbd> move · <kbd>Enter</kbd> launch · <kbd>/</kbd> search · <kbd>Esc</kbd> clear
          </p>
        </div>

        <button
          type="button"
          className="launch__start"
          onClick={() => spotlight && onStart(spotlight.scenario_id)}
          disabled={!canStart}
          aria-label={
            spotlight ? `Start analysis on ${spotlight.name}` : 'Start analysis — no targets available'
          }
        >
          {isRunning ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />}
          <span>
            {isRunning
              ? mode === 'trainer'
                ? 'Loading the question'
                : 'Analyzing'
              : mode === 'trainer'
                ? selected
                  ? 'Open the trainer'
                  : `Train on ${spotlight?.name ?? '—'}`
                : selected
                  ? 'Start attack'
                  : `Start on ${spotlight?.name ?? '—'}`}
          </span>
          {!isRunning && spotlight && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </footer>
    </section>
  );
}

function LaunchTotal({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="launch__total">
      <span className="launch__total-label">{label}</span>
      <span className="launch__total-value">{value}</span>
      <span className="launch__total-detail">{detail}</span>
    </div>
  );
}

interface TargetProps {
  pack: ScenarioSummary;
  index: number;
  busiest: number;
  selected: boolean;
  onSelect: (scenarioId: string) => void;
  onStart: (scenarioId?: string) => void;
}

function TargetCard({ pack, index, busiest, selected, onSelect, onStart }: TargetProps) {
  const tone = pack.scenario_type === 'attack' ? 'attack' : 'benign';
  const briefing = pack.briefing;
  const share = busiest > 0 ? Math.max(6, Math.round(((pack.event_count ?? 0) / busiest) * 100)) : 0;

  return (
    <button
      type="button"
      className={`launch-card launch-card--${tone}${selected ? ' launch-card--selected' : ''}`}
      style={{ animationDelay: `${Math.max(0, index) * 45}ms` }}
      onClick={() => onSelect(pack.scenario_id)}
      onDoubleClick={() => onStart(pack.scenario_id)}
      aria-pressed={selected}
      title="Click to lock · double-click to launch"
    >
      <span className="launch-card__top">
        <span className={`badge badge--${tone}`}>{tone === 'attack' ? 'ATTACK' : 'BENIGN'}</span>
        <span className="launch-card__index" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
      </span>

      <span className="launch-card__name">{pack.name}</span>
      <span className="launch-card__description">{pack.description}</span>

      <MicroTopology briefing={briefing} showLabels={false} />

      {briefing?.services && briefing.services.length > 0 && (
        <span className="launch-card__chips">
          {briefing.services.slice(0, 4).map((service) => (
            <span key={service} className="launch-chip">
              {service}
            </span>
          ))}
        </span>
      )}

      <span className="launch-card__stats">
        <LaunchStat icon={Database} label={count(pack.event_count ?? 0, 'event')} />
        <LaunchStat icon={Workflow} label={count(pack.workflow_count ?? 0, 'workflow')} />
        <LaunchStat icon={Crosshair} label={count(pack.candidate_count ?? 0, 'fix')} />
      </span>

      <span className="launch-card__meter" aria-hidden="true">
        <span style={{ width: `${share}%` }} />
      </span>

      <span className="launch-card__sweep" aria-hidden="true" />
      <span className="launch-card__pick">
        {selected ? 'Locked' : 'Lock target'} <ArrowRight size={11} aria-hidden="true" />
      </span>
    </button>
  );
}

function LaunchStat({ icon: Icon, label }: { icon: typeof Database; label: string }) {
  return (
    <span className="launch-card__stat">
      <Icon size={11} aria-hidden="true" /> {label}
    </span>
  );
}

/**
 * The topology the twin will trace over, drawn from the pack's own nodes and
 * observed actor → target edges. Positions are derived from node kind, so the
 * same data yields the same picture every render.
 */
function MicroTopology({ briefing, showLabels }: { briefing?: LaunchBriefing; showLabels: boolean }) {
  const nodes = briefing?.glyph?.nodes ?? [];
  const links = briefing?.glyph?.links ?? [];
  if (nodes.length === 0) {
    return (
      <span className={`launch-glyph${showLabels ? ' launch-glyph--wide' : ''}`}>
        <svg viewBox="0 0 300 120" role="img" aria-label="No topology in this pack">
          <rect x="1" y="1" width="298" height="118" rx="10" className="launch-glyph__empty" />
        </svg>
      </span>
    );
  }

  const columns = KIND_ORDER.map((kind) => ({
    kind,
    members: nodes.filter((node) => node.kind === kind),
  })).filter((column) => column.members.length > 0);

  const placed: (LaunchGlyphNode & { x: number; y: number })[] = [];
  columns.forEach((column, columnIndex) => {
    const x = columns.length === 1 ? 150 : 40 + (columnIndex * 220) / (columns.length - 1);
    column.members.forEach((node, rowIndex) => {
      const y = 60 + (rowIndex - (column.members.length - 1) / 2) * 30;
      placed.push({ ...node, x, y: Math.max(16, Math.min(104, y)) });
    });
  });

  return (
    <span className={`launch-glyph${showLabels ? ' launch-glyph--wide' : ''}`} aria-hidden={!showLabels}>
      <svg viewBox="0 0 300 120" role={showLabels ? 'img' : undefined} aria-label={showLabels ? 'Target topology preview' : undefined}>
        {links.map((link, index) => {
          const from = placed[link.from];
          const to = placed[link.to];
          if (!from || !to) return null;
          return (
            <line
              key={`link-${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className="launch-glyph__link"
              style={{ animationDelay: `${index * 220}ms` }}
            />
          );
        })}
        {placed.map((node, index) => (
          <g key={`${node.arn}-${index}`} transform={`translate(${node.x}, ${node.y})`}>
            {node.compromised && <circle r={11} className="launch-glyph__halo" style={{ animationDelay: `${index * 180}ms` }} />}
            <circle r={node.compromised || node.sensitive ? 6.5 : 5} fill={KIND_COLOR[node.kind] ?? 'var(--accent-info)'} />
            {showLabels && (
              <text y={node.y > 60 ? 20 : -12} className="launch-glyph__label">
                {node.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </span>
  );
}

interface SpotlightProps {
  pack: ScenarioSummary;
  isLocked: boolean;
  isRunning: boolean;
  onStart: (scenarioId?: string) => void;
  formatTimestamp: (iso: string) => string;
}

function LaunchSpotlight({ pack, isLocked, isRunning, onStart, formatTimestamp }: SpotlightProps) {
  const briefing = pack.briefing;
  const tone = pack.scenario_type === 'attack' ? 'attack' : 'benign';
  const facts: { label: string; value: string; warn?: boolean }[] = [
    { label: 'CloudTrail events', value: count(pack.event_count ?? 0, 'event') },
    {
      label: 'Event window',
      value: briefing ? `${formatTimestamp(briefing.window.first)} → ${formatTimestamp(briefing.window.last)} · ${spanLabel(briefing.window.span_minutes)}` : '—',
    },
    {
      label: 'Identities',
      value: briefing
        ? `${count(briefing.identities.principals, 'principal')} · ${count(briefing.identities.roles, 'role')} · ${count(briefing.identities.workloads, 'workload')}`
        : '—',
    },
    {
      label: 'Resources',
      value: briefing
        ? `${count(briefing.resource_count, 'resource')}${briefing.sensitive_resources ? ` · ${briefing.sensitive_resources} sensitive` : ''}`
        : '—',
      warn: Boolean(briefing && briefing.sensitive_resources > 0),
    },
    { label: 'Business workflows', value: `${count(pack.workflow_count ?? 0, 'workflow')}${briefing?.highest_workflow_criticality ? ` · ${briefing.highest_workflow_criticality}` : ''}` },
    { label: 'Fix candidates', value: count(pack.candidate_count ?? 0, 'candidate') },
  ];

  return (
    <div className="launch__spotlight" data-tone={tone}>
      <div className="launch__spotlight-copy">
        <p className="launch__eyebrow">
          <Crosshair size={12} aria-hidden="true" /> {isLocked ? 'Locked target' : 'Recommended first run'}
        </p>
        <h2 className="launch__spotlight-title">{pack.name}</h2>
        <p className="launch__spotlight-desc">{pack.description}</p>

        <dl className="launch__facts">
          {facts.map((fact) => (
            <div key={fact.label} className={`launch__fact${fact.warn ? ' launch__fact--warn' : ''}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>

        {briefing && briefing.actions.length > 0 && (
          <p className="launch__actions">
            {briefing.actions.map((action) => (
              <span key={action} className="launch-chip launch-chip--mono">
                {action}
              </span>
            ))}
          </p>
        )}

        <p className="launch__spotlight-flags">
          {briefing && briefing.publicly_exposed_resources > 0 && (
            <span className="launch-flag launch-flag--danger">
              <KeyRound size={11} aria-hidden="true" /> {count(briefing.publicly_exposed_resources, 'policy', 'policies')} open to *
            </span>
          )}
          {briefing && briefing.failed_events > 0 && (
            <span className="launch-flag">
              {count(briefing.failed_events, 'failed call')} in the stream
            </span>
          )}
          {briefing && briefing.unsupported_events > 0 && (
            <span className="launch-flag">
              {count(briefing.unsupported_events, 'event')} outside the normalizer
            </span>
          )}
          {briefing && briefing.regions.length > 0 && (
            <span className="launch-flag">{briefing.regions.join(' · ')}</span>
          )}
        </p>
      </div>

      <div className="launch__spotlight-map">
        <MicroTopology briefing={briefing} showLabels />
        <button
          type="button"
          className="launch__spotlight-start"
          onClick={() => onStart(pack.scenario_id)}
          disabled={isRunning}
        >
          {isRunning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} fill="currentColor" />}
          {isRunning ? 'Analyzing…' : 'Launch on this target'}
        </button>
        {briefing && briefing.glyph.nodes.length > 0 && (
          <p className="launch__map-legend">
            {KIND_ORDER.filter((kind) => briefing.glyph.nodes.some((node) => node.kind === kind)).map((kind) => (
              <span key={kind} className="launch-legend-item">
                <i style={{ background: KIND_COLOR[kind] }} aria-hidden="true" />
                {kind}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
