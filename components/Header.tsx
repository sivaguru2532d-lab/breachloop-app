/**
 * Header - Top navigation bar with scenario badge, provider indicator, and actions
 */

import React from 'react';
import { House, Menu, Download, ExternalLink, FileJson, Zap, Shield } from 'lucide-react';
import { AwsRef, SYNTHETIC_ACCOUNT_ID } from '@/components/AwsRef';
import type { ScenarioSummary } from '@/lib/types';

interface HeaderProps {
  scenario: ScenarioSummary | undefined;
  providerMode: 'deterministic' | 'anthropic';
  onProviderChange: (mode: 'deterministic' | 'anthropic') => void;
  onRunIncident: () => void;
  onRunBenchmark: () => void;
  onDownloadReport: () => void;
  /** Optional: exports the canonical incident event log (JSONL). */
  onDownloadEventLog?: () => void;
  onToggleSidebar: () => void;
  /** Optional: back to the launch pad (clears the current incident view). */
  onHome?: () => void;
  /** AWS account IDs the reconstructed incident actually lives in. */
  accountIds?: string[];
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
  onDownloadEventLog,
  onToggleSidebar,
  onHome,
  accountIds,
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

        {Array.isArray(accountIds) && accountIds.length > 0 && (
          <div
            className="header__account"
            title="Account the events in this incident were attributed to. In this lab they are all synthetic, so the link opens AWS documentation about account identifiers rather than the AWS console."
          >
            <span className="header__account-label">Account</span>
            {accountIds.map(id => (
              <span key={id} className={`header__account-value${id === SYNTHETIC_ACCOUNT_ID ? ' header__account-value--synthetic' : ''}`}>
                <AwsRef value={id} label={id} />
              </span>
            ))}
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
        {onHome && (
          <button
            type="button"
            className="btn btn--ghost btn--icon header__home"
            onClick={onHome}
            aria-label="Home — back to target selection"
            title="Home — back to target selection"
          >
            <House size={18} />
          </button>
        )}

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

        {onDownloadEventLog && (
          <button
            className="btn btn--ghost btn--sm"
            onClick={onDownloadEventLog}
            aria-label="Export incident event log"
            title="Export incident event log (JSONL)"
          >
            <FileJson size={14} />
            Log
          </button>
        )}

        <button
          className="btn btn--secondary btn--sm"
          onClick={onDownloadReport}
          disabled={!hasReport}
          aria-label="Download evidence report"
          title="Download the evidence report as JSON"
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