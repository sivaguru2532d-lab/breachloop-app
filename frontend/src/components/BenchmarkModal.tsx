/**
 * BenchmarkModal - 12-scenario synthetic benchmark scorecard with metrics
 */

import React from 'react';
import { X, CheckCircle, XCircle, AlertTriangle, TrendingUp } from 'lucide-react';
import type { BenchmarkSummary } from '../types';

interface BenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  benchmark: BenchmarkSummary | null;
  className?: string;
}

function getStatusIcon(status: 'verified' | 'rejected' | 'unverified') {
  switch (status) {
    case 'verified':
      return <CheckCircle size={14} color="var(--accent-verified)" />;
    case 'rejected':
      return <XCircle size={14} color="var(--accent-critical)" />;
    case 'unverified':
      return <AlertTriangle size={14} color="var(--accent-warning)" />;
  }
}

export function BenchmarkModal({
  isOpen,
  onClose,
  benchmark,
  className = '',
}: BenchmarkModalProps) {
  if (!isOpen || !benchmark) return null;

  const totalScenarios = benchmark.total_scenarios;
  const verifiedCount = benchmark.passed_scenarios;
  const rejectedCount = benchmark.failed_scenarios;
  const totalTimeSeconds = benchmark.results.reduce((total, result) => total + result.execution_time_ms / 1000, 0);
  const averageTimeSeconds = benchmark.total_scenarios ? totalTimeSeconds / benchmark.total_scenarios : 0;

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

        <div style={{ padding: 'var(--space-4)', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <div style={{ padding: 'var(--space-3)', background: 'var(--accent-verified-soft)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-verified)' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Verified</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-verified)' }}>{verifiedCount}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{Math.round((verifiedCount / totalScenarios) * 100)}%</div>
            </div>

            <div style={{ padding: 'var(--space-3)', background: 'var(--accent-critical-soft)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-critical)' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rejected</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-critical)' }}>{rejectedCount}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{Math.round((rejectedCount / totalScenarios) * 100)}%</div>
            </div>

            <div style={{ padding: 'var(--space-3)', background: 'var(--accent-primary-soft)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-primary)' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Accuracy</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{benchmark.accuracy_percentage.toFixed(1)}%</div>
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
                  {benchmark.results.map(result => (
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
