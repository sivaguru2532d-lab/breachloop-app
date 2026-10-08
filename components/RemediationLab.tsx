/**
 * RemediationLab - Side-by-side comparison of remediation candidates with verification status
 */

import React from 'react';
import { CheckCircle, XCircle, AlertTriangle, Shield, Zap } from 'lucide-react';
import type { CandidateAction, UiSimulationResult } from '@/lib/types';

interface RemediationLabProps {
  candidates: CandidateAction[];
  simulations: Record<string, UiSimulationResult>;
  onApply?: (candidateId: string) => void;
  className?: string;
}

function getStatusBadge(status: 'verified' | 'rejected' | 'unverified') {
  switch (status) {
    case 'verified':
      return (
        <span className="badge badge--verified" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <CheckCircle size={12} />
          VERIFIED
        </span>
      );
    case 'rejected':
      return (
        <span className="badge badge--rejected" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <XCircle size={12} />
          REJECTED
        </span>
      );
    case 'unverified':
      return (
        <span className="badge badge--unverified" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <AlertTriangle size={12} />
          UNVERIFIED
        </span>
      );
  }
}

function getStatusColor(status: 'verified' | 'rejected' | 'unverified') {
  switch (status) {
    case 'verified':
      return 'var(--accent-verified)';
    case 'rejected':
      return 'var(--accent-critical)';
    case 'unverified':
      return 'var(--accent-warning)';
  }
}

export function RemediationLab({
  candidates,
  simulations,
  onApply,
  className = '',
}: RemediationLabProps) {
  return (
    <div className={`card ${className}`}>
      <div className="card__header">
        <div className="card__title">
          <Shield className="card__title-icon" size={18} />
          Remediation Laboratory
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
        {candidates.map((candidate) => {
          const simulation = simulations[candidate.candidate_id];
          if (!simulation) return null;

          return (
            <div
              key={candidate.candidate_id}
              className="remediation-card"
              style={{
                background: 'var(--bg-glass-subtle)',
                borderRadius: 'var(--radius-md)',
                border: `2px solid ${getStatusColor(simulation.status)}`,
                padding: 'var(--space-4)',
                transition: 'all var(--motion-fast) var(--ease-out)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-1)' }}>
                    Candidate {candidate.candidate_id}
                  </div>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
                    {candidate.action_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </h3>
                </div>
                {getStatusBadge(simulation.status)}
              </div>

              <div style={{ marginBottom: 'var(--space-3)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Reasoning</div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {candidate.reasoning}
                </p>
              </div>

              <div style={{ marginBottom: 'var(--space-3)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Parameters</div>
                <div style={{ background: 'var(--bg-glass-strong)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                  {Object.entries(candidate.parameters).map(([key, value]) => (
                    <div key={key} style={{ marginBottom: 'var(--space-1)' }}>
                      <span style={{ color: 'var(--accent-info)' }}>{key}:</span>{' '}
                      <span style={{ color: 'var(--text-primary)' }}>
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', background: simulation.status === 'verified' ? 'var(--accent-verified-soft)' : simulation.status === 'rejected' ? 'var(--accent-critical-soft)' : 'var(--accent-warning-soft)', borderRadius: 'var(--radius-sm)', border: `1px solid ${getStatusColor(simulation.status)}` }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Digital Twin Result</div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-primary)', lineHeight: 1.5, fontWeight: 500 }}>
                  {simulation.proof_or_reason}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Attacker Stopped</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: simulation.attacker_reachability_blocked ? 'var(--accent-verified)' : 'var(--accent-critical)' }}>
                    {simulation.attacker_reachability_blocked ? 'YES' : 'NO'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Workflows Intact</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: simulation.business_workflows_intact ? 'var(--accent-verified)' : 'var(--accent-critical)' }}>
                    {simulation.business_workflows_intact ? 'YES' : 'NO'}
                  </div>
                </div>
              </div>

              {simulation.broken_workflows && simulation.broken_workflows.length > 0 && (
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Broken Workflows</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    {simulation.broken_workflows.map((workflow, idx) => (
                      <div key={idx} style={{ fontSize: '0.7rem', color: 'var(--accent-critical)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                        <AlertTriangle size={10} />
                        {workflow}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {onApply && simulation.status === 'verified' && (
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => onApply(candidate.candidate_id)}
                  style={{ width: '100%' }}
                >
                  <Zap size={14} />
                  Apply Remediation
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
