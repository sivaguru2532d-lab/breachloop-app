/**
 * Header - Top navigation bar with scenario badge, provider indicator, and actions
 */

import React from 'react';
import { Menu, Download, ExternalLink, Settings, Zap, Shield } from 'lucide-react';
import type { ScenarioSummary } from '../types';

interface HeaderProps {
  scenario: ScenarioSummary | undefined;
  providerMode: 'deterministic' | 'anthropic';
  onProviderChange: (mode: 'deterministic' | 'anthropic') => void;
  onRunIncident: () => void;
  onRunBenchmark: () => void;
  onDownloadReport: () => void;
  onToggleSidebar: () => void;
  isRunning: boolean;
  hasReport: boolean;
  sidebarOpen: boolean;
}

export function Header({
  scenario,
  providerMode,
  onProviderChange,
  onRunIncident,
  onRunBenchmark,
  onDownloadReport,
  onToggleSidebar,
  isRunning,
  hasReport,
  sidebarOpen,
}: HeaderProps) {
  return (
    <header className="header" role="banner">
      <div className="header__brand">
        <div className="header__logo" aria-hidden="true">
          <Shield size={20} />
        </div>
        <div>
          <h1 className="header__title">BreachLoop</h1>
          <span className="header__subtitle">SOC Console</span>
        </div>
      </div>

      <div className="header__center">
        {scenario && (
          <div className={`header__scenario-badge header__scenario-badge--active ${scenario.scenario_type === 'attack' ? 'sidebar__scenario-item--attack' : 'sidebar__scenario-item--benign'}`}>
            <span className={`sidebar__scenario-type ${scenario.scenario_type === 'attack' ? 'sidebar__scenario-type--attack' : 'sidebar__scenario-type--benign'}`}>
              {scenario.scenario_type.toUpperCase()}
            </span>
            <span>{scenario.name}</span>
          </div>
        )}

        <div className="header__provider">
          <span>Provider:</span>
          <span className={`header__provider-indicator ${providerMode === 'deterministic' ? 'header__provider-indicator--deterministic' : 'header__provider-indicator--anthropic'}`} aria-hidden="true" />
          <span>{providerMode === 'deterministic' ? 'Deterministic' : 'Anthropic'}</span>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => onProviderChange(providerMode === 'deterministic' ? 'anthropic' : 'deterministic')}
            disabled={isRunning}
            aria-label={`Switch to ${providerMode === 'deterministic' ? 'Anthropic' : 'Deterministic'} provider`}
          >
            <Zap size={12} />
          </button>
        </div>
      </div>

      <div className="header__actions">
        <button
          className="btn btn--ghost btn--icon"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-expanded={sidebarOpen}
        >
          <Menu size={18} />
        </button>

        <button
          className="btn btn--ghost btn--icon"
          onClick={onRunBenchmark}
          aria-label="Run benchmark suite"
          title="Run Benchmark"
        >
          <ExternalLink size={18} />
        </button>

        <button
          className="btn btn--secondary btn--sm"
          onClick={onDownloadReport}
          disabled={!hasReport}
          aria-label="Download evidence report"
        >
          <Download size={14} />
          Report
        </button>

        <button
          className="btn btn--primary"
          onClick={onRunIncident}
          disabled={!scenario || isRunning}
          aria-label={isRunning ? 'Analysis in progress' : 'Run incident analysis'}
        >
          {isRunning ? (
            <>
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="31.4 31.4" style={{ animation: 'spin 1s linear infinite' }} />
              </svg>
              Analyzing...
            </>
          ) : (
            <>
              <Zap size={14} />
              Run Incident
            </>
          )}
        </button>
      </div>
    </header>
  );
}