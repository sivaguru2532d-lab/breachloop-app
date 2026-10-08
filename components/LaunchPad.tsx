/**
 * LaunchPad — what the analyst sees before any run, instead of a dead
 * "Ready to Analyze" panel.
 *
 * It answers the two questions an empty console actually poses: *what can I
 * point this at*, and *how do I start*. Every scenario pack in the loaded cloud
 * inventory is selectable here as a target, split into attack simulations and
 * benign baselines, and one prominent control launches the run.
 *
 * Motion rules: entrance staggers, the radar sweep and the standby pulse are
 * all pure CSS, so the `prefers-reduced-motion` block in styles/index.css
 * flattens them (and this file zeroes its own animation delays, which the
 * global block leaves alone). No requestAnimationFrame lives here.
 */

import React from 'react';
import {
  ArrowRight,
  Crosshair,
  Database,
  Loader2,
  Play,
  Radar,
  RotateCw,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ScenarioSummary } from '@/lib/types';

interface LaunchPadProps {
  scenarios: ScenarioSummary[];
  selectedScenarioId: string | null;
  onSelect: (scenarioId: string) => void;
  onStart: () => void;
  isRunning?: boolean;
  /** The API could not be reached at all. */
  unavailable?: boolean;
  /** The API answered, but delivered no packs. */
  empty?: boolean;
  apiBase?: string;
  onReload?: () => void;
  className?: string;
}

const STAT_ICONS = { events: Database, workflows: Workflow, fixes: Crosshair };

function statLabel(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
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
  onReload,
  className = '',
}: LaunchPadProps) {
  const packs = Array.isArray(scenarios) ? scenarios : [];
  const attackPacks = packs.filter((pack) => pack?.scenario_type === 'attack');
  const benignPacks = packs.filter((pack) => pack?.scenario_type !== 'attack');
  const selected = packs.find((pack) => pack?.scenario_id === selectedScenarioId) ?? null;
  const canStart = Boolean(selected) && !isRunning;

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
    <section className={`launch ${className}`} aria-label="Threat simulation launch pad">
      {/* Decorative sweep: a radar, not a data view. */}
      <div className="launch__radar" aria-hidden="true">
        <span />
      </div>

      <header className="launch__header">
        <p className="launch__eyebrow">
          <Radar size={12} aria-hidden="true" /> Cloud digital twin · {packs.length} environment
          {packs.length === 1 ? '' : 's'} armed
        </p>
        <h1 className="launch__title">Choose a cloud to attack</h1>
        <p className="launch__lede">
          Every target below is a synthetic AWS account: CloudTrail events, IAM graph, live business workflows.
          Pick one and the twin reconstructs the attack path, then proves each fix against it.
        </p>
      </header>

      <div className="launch__groups">
        <LaunchGroup
          title="Attack simulations"
          count={attackPacks.length}
          tone="attack"
          packs={attackPacks}
          offset={0}
          selectedScenarioId={selectedScenarioId}
          onSelect={onSelect}
        />
        <LaunchGroup
          title="Benign baselines"
          count={benignPacks.length}
          tone="benign"
          packs={benignPacks}
          offset={attackPacks.length}
          selectedScenarioId={selectedScenarioId}
          onSelect={onSelect}
        />
      </div>

      <footer className="launch__console">
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
              <ShieldCheck size={13} aria-hidden="true" /> Standby — select a target to arm the twin
            </>
          )}
        </p>

        <button
          type="button"
          className="launch__start"
          onClick={onStart}
          disabled={!canStart}
          aria-label={selected ? `Start analysis on ${selected.name}` : 'Start analysis — select a target first'}
        >
          {isRunning ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />}
          <span>{isRunning ? 'Analyzing' : selected ? 'Start attack' : 'Select a target'}</span>
          {!isRunning && selected && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </footer>
    </section>
  );
}

interface LaunchGroupProps {
  title: string;
  count: number;
  tone: 'attack' | 'benign';
  packs: ScenarioSummary[];
  offset: number;
  selectedScenarioId: string | null;
  onSelect: (scenarioId: string) => void;
}

function LaunchGroup({ title, count, tone, packs, offset, selectedScenarioId, onSelect }: LaunchGroupProps) {
  if (count === 0) return null;

  return (
    <div className="launch__group">
      <h2 className={`launch__group-title launch__group-title--${tone}`}>
        {tone === 'attack' ? <Crosshair size={12} aria-hidden="true" /> : <Workflow size={12} aria-hidden="true" />}
        {title} <span>{count}</span>
      </h2>
      <div className="launch__grid">
        {packs.map((pack, index) => {
          const isSelected = pack.scenario_id === selectedScenarioId;
          return (
            <button
              key={pack.scenario_id}
              type="button"
              className={`launch-card launch-card--${tone}${isSelected ? ' launch-card--selected' : ''}`}
              style={{ animationDelay: `${(offset + index) * 55}ms` }}
              onClick={() => onSelect(pack.scenario_id)}
              aria-pressed={isSelected}
            >
              <span className="launch-card__index" aria-hidden="true">
                {String(offset + index + 1).padStart(2, '0')}
              </span>
              <span className={`badge badge--${tone}`}>{tone === 'attack' ? 'ATTACK' : 'BENIGN'}</span>

              <span className="launch-card__name">{pack.name}</span>
              <span className="launch-card__description">{pack.description}</span>

              <span className="launch-card__stats">
                <LaunchStat icon={STAT_ICONS.events} label={statLabel(pack.event_count, 'event', 'events')} />
                <LaunchStat icon={STAT_ICONS.workflows} label={statLabel(pack.workflow_count, 'workflow', 'workflows')} />
                <LaunchStat icon={STAT_ICONS.fixes} label={statLabel(pack.candidate_count, 'fix', 'fixes')} />
              </span>

              <span className="launch-card__sweep" aria-hidden="true" />
              <span className="launch-card__pick">
                {isSelected ? 'Selected' : 'Inspect'} <ArrowRight size={11} aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LaunchStat({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="launch-card__stat">
      <Icon size={11} aria-hidden="true" /> {label}
    </span>
  );
}
