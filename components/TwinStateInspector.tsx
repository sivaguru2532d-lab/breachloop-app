/**
 * TwinStateInspector - Reachability matrix and business workflow health visualization
 */

import React, { useState } from 'react';
import { Activity, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import type { UiSimulationResult, Workflow } from '@/lib/types';

interface TwinStateInspectorProps {
  baselineWorkflows: Workflow[];
  simulations: Record<string, UiSimulationResult>;
  className?: string;
}

export function TwinStateInspector({
  baselineWorkflows,
  simulations,
  className = '',
}: TwinStateInspectorProps) {
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(
    Object.keys(simulations)[0] || null
  );

  const selectedSimulation = selectedCandidate ? simulations[selectedCandidate] : null;

  return (
    <div className={`card ${className}`}>
      <div className="card__header">
        <div className="card__title">
          <Activity className="card__title-icon" size={18} />
          Digital Twin State Inspector
        </div>
      </div>

      <div style={{ padding: 'var(--space-4)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 'var(--space-2)', display: 'block' }}>
            Select Remediation Candidate
          </label>
          <select
            value={selectedCandidate || ''}
            onChange={(e) => setSelectedCandidate(e.target.value)}
            style={{
              width: '100%',
              padding: 'var(--space-2)',
              background: 'var(--bg-glass-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {Object.keys(simulations).map((candidateId) => (
              <option key={candidateId} value={candidateId}>
                Candidate {candidateId} - {simulations[candidateId].status.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        {selectedSimulation && (
          <>
            <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--bg-glass-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
                Simulation Summary
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }}>
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Status</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: selectedSimulation.status === 'verified' ? 'var(--accent-verified)' : selectedSimulation.status === 'rejected' ? 'var(--accent-critical)' : 'var(--accent-warning)' }}>
                    {selectedSimulation.status.toUpperCase()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Attacker Blocked</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: selectedSimulation.attacker_reachability_blocked ? 'var(--accent-verified)' : 'var(--accent-critical)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    {selectedSimulation.attacker_reachability_blocked ? <CheckCircle size={14} /> : <XCircle size={14} />}
                    {selectedSimulation.attacker_reachability_blocked ? 'YES' : 'NO'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Workflows Intact</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: selectedSimulation.business_workflows_intact ? 'var(--accent-verified)' : 'var(--accent-critical)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    {selectedSimulation.business_workflows_intact ? <CheckCircle size={14} /> : <XCircle size={14} />}
                    {selectedSimulation.business_workflows_intact ? 'YES' : 'NO'}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                Business Workflow Health Matrix
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ textAlign: 'left', padding: 'var(--space-2)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Workflow</th>
                      <th style={{ textAlign: 'left', padding: 'var(--space-2)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Principal</th>
                      <th style={{ textAlign: 'left', padding: 'var(--space-2)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Action</th>
                      <th style={{ textAlign: 'left', padding: 'var(--space-2)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Resource</th>
                      <th style={{ textAlign: 'center', padding: 'var(--space-2)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baselineWorkflows.map((workflow, idx) => {
                      const isBroken = selectedSimulation.broken_workflows?.includes(workflow.workflow_name) ?? false;
                      return (
                        <tr
                          key={idx}
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            background: isBroken ? 'var(--accent-critical-soft)' : 'transparent',
                            transition: 'background var(--motion-fast) var(--ease-out)',
                          }}
                        >
                          <td style={{ padding: 'var(--space-2)', color: 'var(--text-primary)', fontWeight: 500 }}>
                            {workflow.workflow_name}
                          </td>
                          <td style={{ padding: 'var(--space-2)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                            {workflow.principal_arn.split('/').pop() || workflow.principal_arn}
                          </td>
                          <td style={{ padding: 'var(--space-2)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                            {workflow.required_action}
                          </td>
                          <td style={{ padding: 'var(--space-2)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                            {workflow.target_resource_arn.split('/').pop() || workflow.target_resource_arn}
                          </td>
                          <td style={{ padding: 'var(--space-2)', textAlign: 'center' }}>
                            {isBroken ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--accent-critical)', fontWeight: 600 }}>
                                <XCircle size={14} />
                                BLOCKED
                              </span>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--accent-verified)', fontWeight: 600 }}>
                                <CheckCircle size={14} />
                                OPERATIONAL
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedSimulation.broken_workflows && selectedSimulation.broken_workflows.length > 0 && (
              <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--accent-critical-soft)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-critical)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                  <AlertTriangle size={16} color="var(--accent-critical)" />
                  <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Workflow Disruption Alert
                  </h4>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  This remediation would break {selectedSimulation.broken_workflows.length} critical business{' '}
                  {selectedSimulation.broken_workflows.length === 1 ? 'workflow' : 'workflows'}:{' '}
                  <strong>{selectedSimulation.broken_workflows.join(', ')}</strong>
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
