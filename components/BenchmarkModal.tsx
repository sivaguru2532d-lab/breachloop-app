/**
 * BenchmarkModal - 12-scenario synthetic benchmark scorecard with metrics
 */

import React, { useEffect } from 'react';
import { X, AlertTriangle, TrendingUp } from 'lucide-react';
import type { BenchmarkSummary } from '@/lib/types';

interface BenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  benchmark: BenchmarkSummary | null;
  className?: string;
}

export function BenchmarkModal({
  isOpen,
  onClose,
  benchmark,
  className = '',
}: BenchmarkModalProps) {
  // Escape must dismiss: the overlay handles pointer clicks, but a keyboard
  // user would otherwise be trapped behind a fixed-position modal.
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !benchmark) return null;

  const results = Array.isArray(benchmark.results) ? benchmark.results : [];
  const totalScenarios = Number.isFinite(benchmark.total_scenarios) ? benchmark.total_scenarios : 0;
  const verifiedCount = Number.isFinite(benchmark.passed_scenarios) ? benchmark.passed_scenarios : 0;
  const rejectedCount = Number.isFinite(benchmark.failed_scenarios) ? benchmark.failed_scenarios : 0;
  const totalTimeSeconds = results.reduce(
    (total, result) => total + (Number.isFinite(result?.execution_time_ms) ? result.execution_time_ms : 0) / 1000,
    0
  );
  const averageTimeSeconds = totalScenarios > 0 ? totalTimeSeconds / totalScenarios : 0;
  // 0 scenarios must read as 0%, never NaN%.
  const share = (count: number) => (totalScenarios > 0 ? Math.round((count / totalScenarios) * 100) : 0);
  const accuracy = Number.isFinite(benchmark.accuracy_percentage)
    ? `${benchmark.accuracy_percentage.toFixed(1)}%`
    : 'n/a';
  const notes = Array.isArray(benchmark.degradation_notes) ? benchmark.degradation_notes : [];

  return (
    <div
      className={`modal-overlay ${className}`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(11, 15, 23, 0.9)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
      onClick={onClose}
    >
      <div
        className="modal-content"
        style={{
          background: 'var(--bg-glass-strong)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          maxWidth: '900px',
          maxHeight: '90vh',
          width: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-1)' }}>
              Benchmark Results
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {totalScenarios} scenarios • {benchmark.passed_scenarios} passed • {benchmark.failed_scenarios} failed
            </p>
          </div>
          <button
            className="btn btn--ghost btn--icon"
            onClick={onClose}
            aria-label="Close benchmark modal"
          >
            <X size={20} />
          </button>
        </div>

        {(benchmark.synthetic || notes.length > 0) && (
          <div
            role="note"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              background: notes.length > 0 ? 'var(--accent-warning-soft)' : 'var(--bg-glass-subtle)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'flex-start',
            }}
          >
            <AlertTriangle size={14} color="var(--accent-warning)" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <p style={{ margin: 0 }}>
                {typeof benchmark.disclaimer === 'string' && benchmark.disclaimer
                  ? benchmark.disclaimer
                  : 'SYNTHETIC BENCHMARK RESULTS ONLY: Metrics evaluated against in-process digital twin pack.'}
              </p>
              {notes.length > 0 && (
                <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: '1.1em', color: 'var(--accent-warning)' }}>
                  {notes.map((note, index) => (
                    <li key={`${index}-${note}`}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div style={{ padding: 'var(--space-4)', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <div style={{ padding: 'var(--space-3)', background: 'var(--accent-verified-soft)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-verified)' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Verified</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-verified)' }}>{verifiedCount}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{share(verifiedCount)}%</div>
            </div>

            <div style={{ padding: 'var(--space-3)', background: 'var(--accent-critical-soft)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-critical)' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rejected</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-critical)' }}>{rejectedCount}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{share(rejectedCount)}%</div>
            </div>

            <div style={{ padding: 'var(--space-3)', background: 'var(--accent-primary-soft)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-primary)' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Accuracy</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{accuracy}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>overall pass rate</div>
            </div>

            <div style={{ padding: 'var(--space-3)', background: 'var(--bg-glass-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Time</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{averageTimeSeconds.toFixed(2)}s</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>per scenario</div>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
              Scenario Details
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <th style={{ textAlign: 'left', padding: 'var(--space-2)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Scenario</th>
                    <th style={{ textAlign: 'left', padding: 'var(--space-2)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Type</th>
                    <th style={{ textAlign: 'left', padding: 'var(--space-2)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Fix outcomes</th>
                    <th style={{ textAlign: 'center', padding: 'var(--space-2)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Best Status</th>
                    <th style={{ textAlign: 'right', padding: 'var(--space-2)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Time (s)</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No scenarios were evaluated.
                      </td>
                    </tr>
                  )}
                  {results.map(result => (
                    <tr
                      key={result.scenario_id}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        background: result.passed ? 'var(--accent-verified-soft)' : 'var(--accent-critical-soft)',
                      }}
                    >
                      <td style={{ padding: 'var(--space-2)', color: 'var(--text-primary)', fontWeight: 500 }}>{result.scenario_name}</td>
                      <td style={{ padding: 'var(--space-2)' }}>
                        <span className={`badge ${result.scenario_type === 'attack' ? 'badge--attack' : 'badge--benign'}`} style={{ fontSize: '0.6rem' }}>
                          {result.scenario_type.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: 'var(--space-2)', color: 'var(--text-secondary)' }}>
                        Broad: {result.broad_fix_status}<br />Narrow: {result.narrow_fix_status}
                      </td>
                      <td style={{ padding: 'var(--space-2)', textAlign: 'center' }}>
                        <span className={`badge ${result.passed ? 'badge--verified' : 'badge--rejected'}`}>{result.passed ? 'PASS' : 'FAIL'}</span>
                      </td>
                      <td style={{ padding: 'var(--space-2)', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {(result.execution_time_ms / 1000).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-muted)', fontSize: '0.7rem' }}>
            <TrendingUp size={14} />
            <span>Total execution: {totalTimeSeconds.toFixed(2)}s</span>
          </div>
          <button className="btn btn--primary btn--sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
