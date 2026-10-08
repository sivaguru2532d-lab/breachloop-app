/**
 * BreachLoop SOC console.
 *
 * Resilience rules enforced here:
 *  - No API condition can lock the screen. Failures become dismissible inline
 *    notices; the shell, sidebar and panels keep rendering.
 *  - Transient failures (cold starts) are retried in the background on a capped
 *    backoff schedule and on window focus, without a spinner that never ends.
 *  - Every panel consumes defensively-normalized data, and each is wrapped in its
 *    own ErrorBoundary, so a malformed attack path degrades one panel, not the app.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RotateCw, X } from 'lucide-react';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { HypothesisBar } from '@/components/HypothesisBar';
import { AttackGraph } from '@/components/AttackGraph';
import { EventTimeline } from '@/components/EventTimeline';
import { RemediationLab } from '@/components/RemediationLab';
import { TwinStateInspector } from '@/components/TwinStateInspector';
import { BenchmarkModal } from '@/components/BenchmarkModal';
import { EvidenceReportView } from '@/components/EvidenceReportView';
import { DynamicBackground } from '@/components/DynamicBackground';
import { MagneticCursor } from '@/components/MagneticCursor';
import { ScrollReveal } from '@/components/ScrollReveal';
import { LaunchPad } from '@/components/LaunchPad';
import {
  EMPTY_SCORE,
  QuizTrainer,
  loadTrainerScore,
  saveTrainerScore,
  type TrainerGrade,
  type TrainerScore,
} from '@/components/QuizTrainer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { api, describeApiBase, formatTimestamp, truncateArn } from '@/lib/api/client';
import { ApiError } from '@/lib/api/fetch';
import type { QuizPreview, BenchmarkSummary, IncidentResponse, ScenarioSummary } from '@/lib/types';

type NoticeTone = 'info' | 'warning' | 'danger';

interface Notice {
  id: string;
  tone: NoticeTone;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  autoDismissMs?: number;
}

/** Background recovery schedule for a transient outage (cold start, 503, abort). */
const RECOVERY_DELAYS_MS = [1000, 2000, 4000, 8000, 8000, 8000];

const TONE_COLOR: Record<NoticeTone, string> = {
  info: 'var(--accent-info)',
  warning: 'var(--accent-warning)',
  danger: 'var(--accent-critical)',
};

function noticeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SocConsole() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [scenariosFailed, setScenariosFailed] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);

  const [incidentData, setIncidentData] = useState<IncidentResponse | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const [benchmarkData, setBenchmarkData] = useState<BenchmarkSummary | null>(null);
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [providerMode, setProviderMode] = useState<'deterministic' | 'anthropic'>('deterministic');

  // Trainer mode: the same packs, but the verdict is withheld until a choice is made.
  const [mode, setMode] = useState<'analyze' | 'trainer'>('analyze');
  const [quizPreview, setQuizPreview] = useState<QuizPreview | null>(null);
  const [quizGrade, setQuizGrade] = useState<TrainerGrade | null>(null);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [trainerScore, setTrainerScore] = useState<TrainerScore>(EMPTY_SCORE);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  /** Bumped on home/select so an in-flight run cannot land after it was dismissed. */
  const runToken = useRef(0);
  const [recovering, setRecovering] = useState(false);

  const noticesRef = useRef<Notice[]>([]);
  noticesRef.current = notices;
  const recoveryAttempt = useRef(0);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);

  const pushNotice = useCallback((notice: Omit<Notice, 'id'> & { id?: string }) => {
    const next: Notice = { id: notice.id ?? noticeId('notice'), ...notice } as Notice;
    setNotices((prev) => {
      // De-duplicate by content so a retry loop cannot stack identical banners.
      if (prev.some((n) => n.title === next.title && n.message === next.message)) return prev;
      return [...prev.filter((n) => n.title !== next.title), next].slice(-4);
    });
    if (next.autoDismissMs) {
      setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== next.id)), next.autoDismissMs);
    }
  }, []);

  const dismissNotice = useCallback((id: string) => {
    setNotices((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const loadScenarios = useCallback(
    async (options: { background?: boolean } = {}) => {
      if (inflight.current) return;
      inflight.current = true;
      if (!options.background) setScenariosLoading(true);

      try {
        const [health, scenarioResult] = await Promise.all([
          api.health().catch(() => null),
          api.listScenarios(),
        ]);

        const list = scenarioResult.data;
        setScenarios(list);
        setScenariosFailed(false);
        setScenariosLoading(false);
        recoveryAttempt.current = 0;
        setRecovering(false);
        if (recoveryTimer.current) clearTimeout(recoveryTimer.current);

        setSelectedScenarioId((prev) => prev ?? list[0]?.scenario_id ?? null);

        // Surface server-reported degradation instead of hiding it.
        for (const note of scenarioResult.degradation.notes) {
          pushNotice({
            tone: 'warning',
            title: 'Served with fallback data',
            message: note,
          });
        }
        if (health?.status === 'degraded') {
          pushNotice({
            tone: 'info',
            title: 'Runtime degraded but operational',
            message: (health.degradation_notes ?? []).join(' ') || 'Some optional capability was unavailable; the console is fully usable.',
            autoDismissMs: 9000,
          });
        }
      } catch (error) {
        const transient = error instanceof ApiError ? error.isTransient : true;
        const detail = error instanceof Error ? error.message : 'Could not reach the BreachLoop API';
        setScenariosLoading(false);
        setScenariosFailed(true);

        if (transient) {
          const attempt = recoveryAttempt.current;
          if (attempt < RECOVERY_DELAYS_MS.length) {
            const delay = RECOVERY_DELAYS_MS[attempt];
            recoveryAttempt.current = attempt + 1;
            setRecovering(true);
            pushNotice({
              id: 'recovering',
              tone: 'info',
              title: `Retrying API (attempt ${attempt + 1}/${RECOVERY_DELAYS_MS.length})`,
              message: `${detail}. Next retry in ${Math.round(delay / 1000)}s — usually a serverless cold start.`,
            });
            recoveryTimer.current = setTimeout(() => void loadScenarios({ background: true }), delay);
          } else {
            setRecovering(false);
            pushNotice({
              id: 'exhausted',
              tone: 'danger',
              title: 'API unreachable',
              message: `${detail}. Background retries are exhausted; the console stays usable and you can retry manually.`,
              actionLabel: 'Retry now',
              onAction: () => {
                recoveryAttempt.current = 0;
                void loadScenarios({ background: true });
              },
            });
          }
        } else {
          setRecovering(false);
          pushNotice({
            id: 'client-error',
            tone: 'danger',
            title: 'API rejected the request',
            message: detail,
            actionLabel: 'Retry',
            onAction: () => void loadScenarios(),
          });
        }
      } finally {
        inflight.current = false;
      }
    },
    [pushNotice]
  );

  // The score is localStorage state, so it can only arrive after hydration.
  useEffect(() => {
    setTrainerScore(loadTrainerScore());
  }, []);

  // Initial load + background recovery on tab focus (a returning user should not
  // have to press Retry after a laptop wakes next to a recycled container).
  useEffect(() => {
    void loadScenarios();
    const onFocus = () => {
      if (scenariosFailed) void loadScenarios({ background: true });
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedScenario = useMemo(
    () => scenarios.find((s) => s.scenario_id === selectedScenarioId),
    [scenarios, selectedScenarioId]
  );

  const handleScenarioSelect = useCallback((scenarioId: string) => {
    runToken.current += 1;
    setSelectedScenarioId(scenarioId);
    setIncidentData(null);
    setQuizPreview(null);
    setQuizGrade(null);
    setQuizError(null);
    setSidebarOpen(false);
  }, []);

  // Toggling mode keeps both payloads: switching back to Analyze should not cost
  // you the run you already made, and vice versa.
  const handleModeChange = useCallback((next: 'analyze' | 'trainer') => {
    if (next === mode) return;
    setMode(next);
    if (typeof window !== 'undefined') {
      const reduced =
        typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    }
  }, [mode]);

  // Which AWS accounts this incident was reconstructed inside. Read off the
  // events themselves rather than hard-coded, so a pack (or a real CloudTrail
  // extract one day) that spans several accounts would show all of them.
  const accountIds = useMemo(() => {
    const ids = new Set<string>();
    const ARN_ACCOUNT = /arn:aws[s]?:[^:]*:[^:]*:(\d{12}):/;
    const scan = (value: unknown) => {
      if (typeof value !== 'string') return;
      const match = ARN_ACCOUNT.exec(value);
      if (match) ids.add(match[1]);
    };
    const events = Array.isArray(incidentData?.events) ? incidentData.events : [];
    events.forEach(event => {
      scan(event.actor_arn);
      scan(event.target_arn);
    });
    const hypothesis = incidentData?.hypothesis;
    (Array.isArray(hypothesis?.impacted_identities) ? hypothesis.impacted_identities : []).forEach(scan);
    (Array.isArray(hypothesis?.impacted_resources) ? hypothesis.impacted_resources : []).forEach(scan);
    return [...ids].sort();
  }, [incidentData]);

  // Home: back to the launch pad. Nothing is fetched and nothing is lost — the
  // run can always be re-executed, which is the point of a deterministic twin.
  const handleHome = useCallback(() => {
    runToken.current += 1;
    setIncidentData(null);
    setSelectedScenarioId(null);
    setQuizPreview(null);
    setQuizGrade(null);
    setQuizError(null);
    setShowBenchmark(false);
    setSidebarOpen(false);
    if (typeof window !== 'undefined') {
      const reduced =
        typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    }
  }, []);

  const handleQuizStart = useCallback(async (scenarioId: string) => {
    const token = ++runToken.current;
    setIsRunning(true);
    setQuizGrade(null);
    setQuizError(null);
    try {
      const preview = await api.quizPreview(scenarioId);
      if (token !== runToken.current) return;
      setQuizPreview(preview);
      setScenariosFailed(false);
    } catch (error) {
      if (token !== runToken.current) return;
      setQuizPreview(null);
      setQuizError(error instanceof Error ? error.message : 'The trainer could not load this pack.');
    } finally {
      if (token === runToken.current) setIsRunning(false);
    }
  }, []);

  const handleQuizAnswer = useCallback(async (optionId: string) => {
    const scenarioId = quizPreview?.scenario_id;
    if (!scenarioId) return;
    try {
      const grade = await api.quizGrade({ scenario_id: scenarioId, option_id: optionId });
      setQuizGrade(grade);
      // An attempt the twin could not grade must not move the score either way.
      if (grade.graded === false) return;
      setTrainerScore((previous) => {
        const streak = grade.correct ? previous.streak + 1 : 0;
        const next: TrainerScore = {
          answered: previous.answered + 1,
          correct: previous.correct + (grade.correct ? 1 : 0),
          streak,
          bestStreak: Math.max(previous.bestStreak, streak),
          results: { ...previous.results, [scenarioId]: grade.correct ? 'correct' : 'wrong' },
        };
        saveTrainerScore(next);
        return next;
      });
    } catch (error) {
      pushNotice({
        tone: 'danger',
        title: 'Answer not graded',
        message: `${error instanceof Error ? error.message : 'Grading failed'} — nothing was recorded, so try again.`,
        autoDismissMs: 8000,
      });
    }
  }, [quizPreview, pushNotice]);

  const handleResetScore = useCallback(() => {
    setTrainerScore(EMPTY_SCORE);
    saveTrainerScore(EMPTY_SCORE);
  }, []);

  const handleRunIncident = useCallback(async (explicitScenarioId?: string) => {
    if (isRunning) return;
    // Called three ways: the header button (no args, and as a click handler so
    // the first argument is a SyntheticEvent), the launch pad's Start, and a
    // double-click on a specific card. Only a real string may pick the target.
    const target = typeof explicitScenarioId === 'string' && explicitScenarioId ? explicitScenarioId : selectedScenarioId;
    if (!target) {
      // The header control stays reachable before the launch pad has a target.
      // Returning silently there reads as a broken button, so say what is
      // missing instead of disabling the whole page's primary action.
      pushNotice({
        tone: 'info',
        title: 'No target selected',
        message: 'Pick a cloud environment on the launch pad, then start the attack.',
        autoDismissMs: 6000,
      });
      return;
    }
    if (mode === 'trainer') {
      // Same click, different contract: the trainer must not fetch the verdict.
      setSelectedScenarioId(target);
      await handleQuizStart(target);
      return;
    }

    const token = ++runToken.current;
    setSelectedScenarioId(target);
    setIsRunning(true);
    try {
      const result = await api.runIncident({
        scenario_id: target,
        provider_mode: providerMode,
      });
      // A newer run, or a Home press, supersedes this response.
      if (token === runToken.current) setIncidentData(result.data);
      setScenariosFailed(false);
      for (const note of result.degradation.notes) {
        pushNotice({ tone: 'warning', title: 'Run completed with fallbacks', message: note });
      }
      if (result.degradation.notes.length === 0) {
        pushNotice({
          tone: 'info',
          title: `${result.data.attack_path?.steps?.length ?? 0} attack step(s) reconstructed`,
          message: `Incident analysis finished for ${target}.`,
          autoDismissMs: 6000,
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to run incident analysis';
      pushNotice({
        tone: 'danger',
        title: 'Incident run failed',
        message: detail,
        actionLabel: 'Retry run',
        onAction: () => void handleRunIncident(),
      });
    } finally {
      setIsRunning(false);
    }
  }, [selectedScenarioId, isRunning, providerMode, pushNotice, mode, handleQuizStart]);

  const handleRunBenchmark = useCallback(async () => {
    try {
      const result = await api.runBenchmark();
      setBenchmarkData(result.data);
      setShowBenchmark(true);
      for (const note of result.degradation.notes) {
        pushNotice({ tone: 'warning', title: 'Benchmark degraded', message: note });
      }
    } catch (error) {
      pushNotice({
        tone: 'danger',
        title: 'Benchmark failed',
        message: error instanceof Error ? error.message : 'Benchmark run failed',
        actionLabel: 'Retry benchmark',
        onAction: () => void handleRunBenchmark(),
      });
    }
  }, [pushNotice]);

  const download = useCallback((filename: string, text: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadReport = useCallback(() => {
    if (!incidentData) return;
    download(
      `breachloop-report-${incidentData.scenario_id}-${Date.now()}.json`,
      JSON.stringify(incidentData.report, null, 2),
      'application/json'
    );
  }, [incidentData, download]);

  const handleDownloadEventLog = useCallback(async () => {
    if (!incidentData) return;
    try {
      const { apiUrl } = await import('@/lib/api/baseUrl');
      const response = await fetch(apiUrl(`/reports/${encodeURIComponent(incidentData.run_id)}?format=jsonl`), {
        cache: 'no-store',
      });
      if (!response.ok) throw new ApiError(response.status, null, `HTTP ${response.status}`, 1, false);
      const text = await response.text();
      download(`breachloop-${incidentData.scenario_id}-incident-log.jsonl`, text, 'application/x-ndjson');
      pushNotice({
        tone: 'info',
        title: 'Incident log exported',
        message: 'Canonical CloudTrail evidence written as newline-delimited JSON.',
        autoDismissMs: 5000,
      });
    } catch (error) {
      // Fall back to a client-side export: the run payload is already in memory.
      const lines = incidentData.events.map((event) => JSON.stringify({ run_id: incidentData.run_id, ...event }));
      download(`breachloop-${incidentData.scenario_id}-incident-log.jsonl`, `${lines.join('\n')}\n`, 'application/x-ndjson');
      pushNotice({
        tone: 'warning',
        title: 'Exported from local state',
        message: error instanceof Error ? error.message : 'Export endpoint unavailable',
      });
    }
  }, [incidentData, download, pushNotice]);

  const attackPath = incidentData?.attack_path;
  const evidenceIds = useMemo(
    () => new Set(attackPath?.evidence_event_ids ?? []),
    [attackPath?.evidence_event_ids]
  );

  return (
    <div className="app">
      <DynamicBackground />
      <MagneticCursor />

      <Header
        scenario={selectedScenario}
        providerMode={providerMode}
        onProviderChange={setProviderMode}
        onRunIncident={() => void handleRunIncident()}
        onRunBenchmark={() => void handleRunBenchmark()}
        onDownloadReport={handleDownloadReport}
        onDownloadEventLog={incidentData ? () => void handleDownloadEventLog() : undefined}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onHome={handleHome}
        accountIds={accountIds}
        mode={mode}
        onModeChange={handleModeChange}
        isRunning={isRunning}
        hasReport={Boolean(incidentData)}
        sidebarOpen={sidebarOpen}
      />

      <div className="main">
        <Sidebar
          scenarios={scenarios}
          selectedScenarioId={selectedScenarioId}
          onScenarioSelect={handleScenarioSelect}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          loading={scenariosLoading}
          unavailable={scenariosFailed && scenarios.length === 0}
        />

        <div
          className={`sidebar-overlay ${sidebarOpen ? 'sidebar-overlay--visible' : ''}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />

        <main className="content">
          {notices.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              {notices.map((notice) => (
                <div
                  key={notice.id}
                  className="card"
                  role={notice.tone === 'danger' ? 'alert' : 'status'}
                  style={{ borderColor: TONE_COLOR[notice.tone] }}
                >
                  <div
                    className="card__body"
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-3)' }}
                  >
                    <span style={{ color: TONE_COLOR[notice.tone], marginTop: 2 }}>
                      {notice.tone === 'danger' || notice.tone === 'warning' ? (
                        <AlertTriangle size={16} />
                      ) : recovering ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={16} />
                      )}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: '0.75rem', display: 'block', marginBottom: 2 }}>{notice.title}</strong>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                        {notice.message}
                      </p>
                    </div>
                    {notice.actionLabel && notice.onAction && (
                      <button type="button" className="btn btn--secondary btn--sm" onClick={notice.onAction}>
                        <RotateCw size={12} /> {notice.actionLabel}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon btn--sm"
                      onClick={() => dismissNotice(notice.id)}
                      aria-label="Dismiss notice"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {scenariosLoading ? (
            <div className="empty-state" role="status">
              <Loader2 className="empty-state__icon animate-spin" size={40} />
              <h2 className="empty-state__title">Connecting to BreachLoop</h2>
              <p className="empty-state__description">Loading the scenario pack from {describeApiBase()}</p>
            </div>
          ) : mode === 'trainer' ? (
            <ErrorBoundary label="Trainer panel">
              <QuizTrainer
                preview={quizPreview}
                grade={quizGrade}
                loading={isRunning}
                error={quizError}
                score={trainerScore}
                onAnswer={(optionId) => void handleQuizAnswer(optionId)}
                onRerun={() => (quizPreview ? void handleQuizStart(quizPreview.scenario_id) : void handleRunIncident())}
                onPickAnother={() => {
                  setQuizPreview(null);
                  setQuizGrade(null);
                  setQuizError(null);
                  setSelectedScenarioId(null);
                }}
                onResetScore={handleResetScore}
                formatTimestamp={formatTimestamp}
                truncateArn={truncateArn}
              />
            </ErrorBoundary>
          ) : isRunning ? (
            <div className="empty-state animate-fade-in-up" role="status">
              <Loader2 className="empty-state__icon animate-spin" size={48} />
              <h2 className="empty-state__title">Analyzing Incident…</h2>
              <p className="empty-state__description">
                Reconstructing the attack path from {selectedScenario?.event_count ?? 0} CloudTrail event(s) and
                simulating every remediation candidate in the digital twin
              </p>
            </div>
          ) : incidentData && attackPath ? (
            <div className="grid animate-fade-in-up">
              <ScrollReveal delay={0}>
                <ErrorBoundary label="Hypothesis panel">
                  <HypothesisBar
                    hypothesis={incidentData.hypothesis}
                    attackPath={attackPath}
                    truncateArn={truncateArn}
                    className="stagger-1"
                  />
                </ErrorBoundary>
              </ScrollReveal>

              <ScrollReveal delay={80}>
                <div className="grid grid--2 stagger-2">
                  <ErrorBoundary label="Attack graph">
                    <AttackGraph
                      attackPath={attackPath}
                      events={incidentData.events ?? []}
                      scenarioDetail={incidentData.scenario_detail ?? null}
                    />
                  </ErrorBoundary>
                  <ErrorBoundary label="Audit timeline">
                    <EventTimeline
                      events={incidentData.events ?? []}
                      attackPathEventIds={evidenceIds}
                      formatTimestamp={formatTimestamp}
                      truncateArn={truncateArn}
                    />
                  </ErrorBoundary>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={160}>
                <ErrorBoundary label="Remediation laboratory">
                  <RemediationLab
                    candidates={incidentData.candidates ?? []}
                    simulations={incidentData.simulations ?? {}}
                    className="stagger-3"
                  />
                </ErrorBoundary>
              </ScrollReveal>

              {Object.keys(incidentData.simulations ?? {}).length > 0 && (
                <ScrollReveal delay={240}>
                  <ErrorBoundary label="Digital twin inspector">
                    <TwinStateInspector
                      baselineWorkflows={incidentData.workflows ?? []}
                      simulations={incidentData.simulations ?? {}}
                      className="stagger-4"
                    />
                  </ErrorBoundary>
                </ScrollReveal>
              )}

              <ScrollReveal delay={320}>
                <ErrorBoundary label="Evidence report">
                  <EvidenceReportView report={incidentData.report} onDownload={handleDownloadReport} className="stagger-5" />
                </ErrorBoundary>
              </ScrollReveal>
            </div>
          ) : (
            <LaunchPad
              scenarios={scenarios}
              selectedScenarioId={selectedScenarioId}
              onSelect={handleScenarioSelect}
              onStart={handleRunIncident}
              isRunning={isRunning}
              unavailable={scenariosFailed && scenarios.length === 0}
              empty={!scenariosFailed && scenarios.length === 0}
              apiBase={describeApiBase()}
              mode={mode}
              onReload={() => void loadScenarios()}
              formatTimestamp={formatTimestamp}
            />
          )}
        </main>
      </div>

      <BenchmarkModal
        isOpen={showBenchmark}
        onClose={() => setShowBenchmark(false)}
        benchmark={benchmarkData}
      />
    </div>
  );
}
