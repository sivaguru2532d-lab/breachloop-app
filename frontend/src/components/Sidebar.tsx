/**
 * Sidebar - Scenario selector with attack/benign categorization
 */

import React from 'react';
import { ChevronRight, Shield, CheckCircle, XCircle, AlertCircle, Database, Cpu, Network, HardDrive } from 'lucide-react';
import type { ScenarioSummary } from '../types';

interface SidebarProps {
  scenarios: ScenarioSummary[];
  selectedScenarioId: string | null;
  onScenarioSelect: (scenarioId: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

function getScenarioIcon(type: string, name: string) {
  if (name.includes('credential') || name.includes('role') || name.includes('sts')) return <Shield size={16} />;
  if (name.includes('lambda') || name.includes('compute') || name.includes('cicd')) return <Cpu size={16} />;
  if (name.includes('network') || name.includes('ssrf') || name.includes('proxy')) return <Network size={16} />;
  if (name.includes('snapshot') || name.includes('storage') || name.includes('s3') || name.includes('billing')) return <Database size={16} />;
  if (name.includes('kms') || name.includes('encrypt') || name.includes('secret')) return <HardDrive size={16} />;
  return <AlertCircle size={16} />;
}

function getScenarioTypeClass(type: string) {
  return type === 'attack' ? 'sidebar__scenario-type--attack' : 'sidebar__scenario-type--benign';
}

function getScenarioItemClass(type: string) {
  return type === 'attack' ? 'sidebar__scenario-item--attack' : 'sidebar__scenario-item--benign';
}

export function Sidebar({
  scenarios,
  selectedScenarioId,
  onScenarioSelect,
  isOpen,
  onClose,
}: SidebarProps) {
  const attackScenarios = scenarios.filter(s => s.scenario_type === 'attack');
  const benignScenarios = scenarios.filter(s => s.scenario_type === 'benign');

  return (
    <>
      <aside
        className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}
        role="navigation"
        aria-label="Scenario selection"
      >
        <div className="sidebar__section">
          <span className="sidebar__label">Attack Scenarios</span>
          <div className="sidebar__scenario-list">
            {attackScenarios.map(scenario => (
              <button
                key={scenario.scenario_id}
                className={`sidebar__scenario-item ${getScenarioItemClass(scenario.scenario_type)} ${selectedScenarioId === scenario.scenario_id ? 'sidebar__scenario-item--active' : ''}`}
                onClick={() => onScenarioSelect(scenario.scenario_id)}
                aria-selected={selectedScenarioId === scenario.scenario_id}
                aria-current={selectedScenarioId === scenario.scenario_id ? 'true' : undefined}
              >
                <span className="sidebar__scenario-icon" aria-hidden="true">
                  {getScenarioIcon(scenario.scenario_type, scenario.name)}
                </span>
                <span className="sidebar__scenario-name">{scenario.name}</span>
                <span className={`sidebar__scenario-type ${getScenarioTypeClass(scenario.scenario_type)}`}>
                  ATTACK
                </span>
                {selectedScenarioId === scenario.scenario_id && (
                  <ChevronRight size={16} className="sidebar__scenario-chevron" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar__section">
          <span className="sidebar__label">Benign Workflows</span>
          <div className="sidebar__scenario-list">
            {benignScenarios.map(scenario => (
              <button
                key={scenario.scenario_id}
                className={`sidebar__scenario-item ${getScenarioItemClass(scenario.scenario_type)} ${selectedScenarioId === scenario.scenario_id ? 'sidebar__scenario-item--active' : ''}`}
                onClick={() => onScenarioSelect(scenario.scenario_id)}
                aria-selected={selectedScenarioId === scenario.scenario_id}
                aria-current={selectedScenarioId === scenario.scenario_id ? 'true' : undefined}
              >
                <span className="sidebar__scenario-icon" aria-hidden="true">
                  {getScenarioIcon(scenario.scenario_type, scenario.name)}
                </span>
                <span className="sidebar__scenario-name">{scenario.name}</span>
                <span className={`sidebar__scenario-type ${getScenarioTypeClass(scenario.scenario_type)}`}>
                  BENIGN
                </span>
                {selectedScenarioId === scenario.scenario_id && (
                  <ChevronRight size={16} className="sidebar__scenario-chevron" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar__section" style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-subtle)' }}>
          <span className="sidebar__label">Legend</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div style={{ width: '12px', height: '3px', background: 'var(--accent-critical)', borderRadius: '2px' }} />
              <span>Attack Path</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div style={{ width: '12px', height: '3px', background: 'var(--accent-info)', borderRadius: '2px' }} />
              <span>Benign Workflow</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-info)' }} />
              <span>Principal</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-warning)' }} />
              <span>Role</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-critical)' }} />
              <span>Resource</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}