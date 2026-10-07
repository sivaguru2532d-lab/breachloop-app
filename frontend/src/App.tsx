/**
 * BreachLoop - AI-Assisted Cloud Incident-Response Simulator
 * Main Application Component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { HypothesisBar } from './components/HypothesisBar';
import { AttackGraph } from './components/AttackGraph';
import { EventTimeline } from './components/EventTimeline';
import { RemediationLab } from './components/RemediationLab';
import { TwinStateInspector } from './components/TwinStateInspector';
import { BenchmarkModal } from './components/BenchmarkModal';
import { EvidenceReportView } from './components/EvidenceReportView';
import { DynamicBackground } from './components/DynamicBackground';
import { MagneticCursor } from './components/MagneticCursor';
import { ScrollReveal } from './components/ScrollReveal';
import { api, formatTimestamp, truncateArn } from './api/client';
import type {
  ScenarioSummary,
  IncidentResponse,
  BenchmarkSummary,
} from './types';
import { Menu, AlertTriangle, Loader2, RotateCw } from 'lucide-react';
import './styles/index.css';

interface AppState {
  scenarios: ScenarioSummary[];
  scenariosLoading: boolean;
  apiError: string | null;
  benchmarkError: string | null;
  selectedScenarioId: string | null;
  incidentData: IncidentResponse | null;
  isRunning: boolean;
  runError: string | null;
  sidebarOpen: boolean;
  benchmarkData: BenchmarkSummary | null;
  showBenchmark: boolean;
  providerMode: 'deterministic' | 'anthropic';
}

const initialState: AppState = {
  scenarios: [],
  scenariosLoading: true,
  apiError: null,
  benchmarkError: null,
  selectedScenarioId: null,
  incidentData: null,
  isRunning: false,
  runError: null,
  sidebarOpen: false,
  benchmarkData: null,
  showBenchmark: false,
  providerMode: 'deterministic',
};

export function App() {
  const [state, setState] = useState<AppState>(initialState);

  const loadScenarios = useCallback(async () => {
    setState(prev => ({ ...prev, scenariosLoading: true, apiError: null }));
    try {
      const [, scenarios] = await Promise.all([api.health(), api.listScenarios()]);
      setState(prev => ({
        ...prev,
        scenarios,
        selectedScenarioId: prev.selectedScenarioId ?? scenarios[0]?.scenario_id ?? null,
        scenariosLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not connect to the BreachLoop API';
      setState(prev => ({ ...prev, scenariosLoading: false, apiError: message }));
    }
  }, []);

  useEffect(() => {
    void loadScenarios();
  }, [loadScenarios]);

  const handleScenarioSelect = useCallback((scenarioId: string) => {
    setState(prev => ({
      ...prev,
      selectedScenarioId: scenarioId,
      incidentData: null,
      runError: null,
      sidebarOpen: false,
    }));
  }, []);

  const handleRunIncident = async () => {
    if (!state.selectedScenarioId || state.isRunning) return;

    setState(prev => ({ ...prev, isRunning: true, runError: null }));

    try {
      const response = await api.runIncident({
        scenario_id: state.selectedScenarioId,
        provider_mode: state.providerMode,
      });

      setState(prev => ({
        ...prev,
        incidentData: response,
        isRunning: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to run incident analysis';
      setState(prev => ({ ...prev, isRunning: false, runError: message }));
    }
  };

  const handleRunBenchmark = async () => {
    setState(prev => ({ ...prev, benchmarkError: null }));
    try {
      const benchmark = await api.runBenchmark();
      setState(prev => ({ ...prev, benchmarkData: benchmark, showBenchmark: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Benchmark run failed';
      setState(prev => ({ ...prev, benchmarkError: message }));
    }
  };

  const handleDownloadReport = () => {
    if (!state.incidentData) return;

    const blob = new Blob([JSON.stringify(state.incidentData.report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `breachloop-report-${state.selectedScenarioId}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getSelectedScenario = (): ScenarioSummary | undefined => {
    return state.scenarios.find(s => s.scenario_id === state.selectedScenarioId);
  };

  return (
    <div className="app">
      <DynamicBackground />
      <MagneticCursor />
      <Header
        scenario={getSelectedScenario()}
        providerMode={state.providerMode}
        onProviderChange={(mode) => setState(prev => ({ ...prev, providerMode: mode }))}
        onRunIncident={handleRunIncident}
        onRunBenchmark={handleRunBenchmark}
        onDownloadReport={handleDownloadReport}
        onToggleSidebar={() => setState(prev => ({ ...prev, sidebarOpen: !prev.sidebarOpen }))}
        isRunning={state.isRunning}
        hasReport={!!state.incidentData}
        sidebarOpen={state.sidebarOpen}
      />

      <div className="main">
        <Sidebar
          scenarios={state.scenarios}
          selectedScenarioId={state.selectedScenarioId}
          onScenarioSelect={handleScenarioSelect}
          isOpen={state.sidebarOpen}
          onClose={() => setState(prev => ({ ...prev, sidebarOpen: false }))}
        />

        <div
          className={`sidebar-overlay ${state.sidebarOpen ? 'sidebar-overlay--visible' : ''}`}
          onClick={() => setState(prev => ({ ...prev, sidebarOpen: false }))}
        />

        <main className="content">
          {state.apiError && (
            <div className="connection-state card" role="alert">
              <div className="card__body">
                <AlertTriangle size={20} />
                <div>
                  <strong>API connection failed</strong>
                  <p>{state.apiError}</p>
                  <span>Start the BreachLoop backend with <code>npm run backend:serve</code>, then retry.</span>
                </div>
                <button className="btn btn--secondary btn--sm" onClick={() => void loadScenarios()}>
                  <RotateCw size={14} /> Retry
                </button>
              </div>
            </div>
          )}
          {state.benchmarkError && (
            <div className="connection-state card" role="alert">
              <div className="card__body">
                <AlertTriangle size={20} />
                <div><strong>Benchmark failed</strong><p>{state.benchmarkError}</p></div>
                <button className="btn btn--secondary btn--sm" onClick={() => void handleRunBenchmark()}>
                  <RotateCw size={14} /> Retry
                </button>
              </div>
            </div>
          )}
          {state.runError && (
            <div className="card animate-fade-in-up" style={{ borderColor: 'var(--accent-critical)', marginBottom: 'var(--space-4)' }}>
              <div className="card__body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', color: 'var(--accent-critical)' }}>
                <AlertTriangle size={20} />
                <span>{state.runError}</span>
              </div>
            </div>
          )}

          {state.scenariosLoading ? (
            <div className="empty-state" role="status">
              <Loader2 className="empty-state__icon animate-spin" size={40} />
              <h2 className="empty-state__title">Connecting to BreachLoop</h2>
              <p className="empty-state__description">Loading scenarios and checking the API</p>
            </div>
          ) : !state.selectedScenarioId ? (
            <div className="empty-state animate-fade-in-up">
              {state.apiError ? <AlertTriangle className="empty-state__icon" size={48} /> : <Menu className="empty-state__icon" size={64} />}
              <h2 className="empty-state__title">{state.apiError ? 'Backend unavailable' : 'No scenarios available'}</h2>
              <p className="empty-state__description">{state.apiError ? 'Start the backend server and retry the connection.' : 'Add scenario JSON files to begin incident analysis.'}</p>
              {state.apiError && <button className="btn btn--secondary" onClick={() => void loadScenarios()}><RotateCw size={14} /> Retry connection</button>}
            </div>
          ) : state.isRunning ? (
            <div className="empty-state animate-fade-in-up">
              <Loader2 className="empty-state__icon animate-spin" size={48} />
              <h2 className="empty-state__title">Analyzing Incident...</h2>
              <p className="empty-state__description">Reconstructing attack path from CloudTrail events</p>
            </div>
          ) : state.incidentData ? (
            <div className="grid animate-fade-in-up">
              <ScrollReveal delay={0}>
                <HypothesisBar
                  hypothesis={state.incidentData.hypothesis}
                  attackPath={state.incidentData.attack_path}
                  formatTimestamp={formatTimestamp}
                  truncateArn={truncateArn}
                  className="stagger-1"
                />
              </ScrollReveal>

              <ScrollReveal delay={80}>
                <div className="grid grid--2 stagger-2">
                  <AttackGraph
                    attackPath={state.incidentData.attack_path}
                    events={state.incidentData.events}
                    scenarioDetail={state.incidentData.scenario_detail}
                  />
                  <EventTimeline
                    events={state.incidentData.events}
                    attackPathEventIds={new Set(state.incidentData.attack_path.evidence_event_ids)}
                    formatTimestamp={formatTimestamp}
                    truncateArn={truncateArn}
                  />
                </div>
              </ScrollReveal>

              <ScrollReveal delay={160}>
                <RemediationLab
                  candidates={state.incidentData.candidates}
                  simulations={state.incidentData.simulations}
                  className="stagger-3"
                />
              </ScrollReveal>

              {Object.keys(state.incidentData.simulations).length > 0 && (
                <ScrollReveal delay={240}>
                  <TwinStateInspector
                    baselineWorkflows={state.incidentData.workflows}
                    simulations={state.incidentData.simulations}
                    className="stagger-4"
                  />
                </ScrollReveal>
              )}

              <ScrollReveal delay={320}>
                <EvidenceReportView
                  report={state.incidentData.report}
                  onDownload={handleDownloadReport}
                  className="stagger-5"
                />
              </ScrollReveal>
            </div>
          ) : (
            <div className="empty-state animate-fade-in-up">
              <AlertTriangle className="empty-state__icon" size={48} />
              <h2 className="empty-state__title">Ready to Analyze</h2>
              <p className="empty-state__description">Click "Run Incident" to reconstruct the attack path from CloudTrail events</p>
            </div>
          )}
        </main>
      </div>

      <BenchmarkModal
        isOpen={state.showBenchmark}
        onClose={() => setState(prev => ({ ...prev, showBenchmark: false }))}
        benchmark={state.benchmarkData}
      />
    </div>
  );
}
