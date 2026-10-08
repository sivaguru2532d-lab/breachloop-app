/**
 * HypothesisBar - Incident hypothesis summary with confidence, attack vector, and evidence
 */

import { AwsRef } from '@/components/AwsRef';
import React from 'react';
import { AlertTriangle, Target, Users, Database, HelpCircle, ArrowRight } from 'lucide-react';
import type { IncidentHypothesis, AttackPath } from '@/lib/types';

interface HypothesisBarProps {
  hypothesis: IncidentHypothesis;
  attackPath: AttackPath;
  truncateArn: (arn: string, maxLength?: number) => string;
  className?: string;
}

function getConfidenceClass(confidence: number): string {
  if (confidence >= 0.8) return 'hypothesis-bar__confidence-fill--high';
  if (confidence >= 0.5) return 'hypothesis-bar__confidence-fill--medium';
  return 'hypothesis-bar__confidence-fill--low';
}

export function HypothesisBar({
  hypothesis,
  attackPath,
  truncateArn,
  className = '',
}: HypothesisBarProps) {
  const confidencePercent = Math.round(hypothesis.confidence * 100);
  const confidenceClass = getConfidenceClass(hypothesis.confidence);

  return (
    <div className={`hypothesis-bar ${className}`} role="region" aria-label="Incident hypothesis">
      <div className="hypothesis-bar__header">
        <h2 className="hypothesis-bar__title">
          <AlertTriangle className="card__title-icon" size={18} />
          Threat Hypothesis
        </h2>
        <div className="hypothesis-bar__confidence">
          <div className="hypothesis-bar__confidence-bar" role="progressbar" aria-valuenow={confidencePercent} aria-valuemin={0} aria-valuemax={100} aria-label={`Confidence: ${confidencePercent}%`}>
            <div className={`hypothesis-bar__confidence-fill ${confidenceClass}`} style={{ width: `${confidencePercent}%` }} />
          </div>
          <span className={`hypothesis-bar__confidence-value ${confidenceClass.replace('hypothesis-bar__confidence-fill--', '')}`}>
            {confidencePercent}%
          </span>
        </div>
      </div>

      <div className="hypothesis-bar__body">
        <div className="hypothesis-bar__field">
          <span className="hypothesis-bar__field-label">Summary</span>
          <p className="hypothesis-bar__field-value">{hypothesis.summary}</p>
        </div>

        <div className="hypothesis-bar__field">
          <span className="hypothesis-bar__field-label">Attack Vector</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Target size={16} color="var(--accent-critical)" />
            <span className="hypothesis-bar__field-value">{hypothesis.attack_vector}</span>
          </div>
        </div>

        <div className="hypothesis-bar__field">
          <span className="hypothesis-bar__field-label">Initial Compromise</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Users size={16} color="var(--accent-warning)" />
            <AwsRef value={attackPath.initial_compromise} label={truncateArn(attackPath.initial_compromise)} />
          </div>
        </div>

        <div className="hypothesis-bar__field">
          <span className="hypothesis-bar__field-label">Target Resource</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Database size={16} color="var(--accent-critical)" />
            <AwsRef value={attackPath.target_resource} label={truncateArn(attackPath.target_resource)} />
          </div>
        </div>

        <div className="hypothesis-bar__field">
          <span className="hypothesis-bar__field-label">Path Length</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <ArrowRight size={16} color="var(--accent-info)" />
            <span className="hypothesis-bar__field-value">{attackPath.steps.length} steps</span>
          </div>
        </div>

        <div className="hypothesis-bar__field">
          <span className="hypothesis-bar__field-label">Evidence Events</span>
          <div className="hypothesis-bar__tags">
            {hypothesis.evidence_event_ids.slice(0, 5).map((eventId) => (
              <span key={eventId} className="badge badge--attack" style={{ fontSize: '0.55rem' }}>
                {eventId.slice(0, 8)}…
              </span>
            ))}
            {hypothesis.evidence_event_ids.length > 5 && (
              <span className="badge badge--unverified" style={{ fontSize: '0.55rem' }}>
                +{hypothesis.evidence_event_ids.length - 5} more
              </span>
            )}
          </div>
        </div>

        {hypothesis.impacted_identities.length > 0 && (
          <div className="hypothesis-bar__field">
            <span className="hypothesis-bar__field-label">Impacted Identities</span>
            <div className="hypothesis-bar__tags">
              {hypothesis.impacted_identities.slice(0, 4).map((arn) => (
                <span key={arn} className="badge badge--warning" style={{ fontSize: '0.55rem' }}>
                  <AwsRef value={arn} label={truncateArn(arn, 30)} />
                </span>
              ))}
              {hypothesis.impacted_identities.length > 4 && (
                <span className="badge badge--unverified" style={{ fontSize: '0.55rem' }}>
                  +{hypothesis.impacted_identities.length - 4} more
                </span>
              )}
            </div>
          </div>
        )}

        {hypothesis.impacted_resources.length > 0 && (
          <div className="hypothesis-bar__field">
            <span className="hypothesis-bar__field-label">Impacted Resources</span>
            <div className="hypothesis-bar__tags">
              {hypothesis.impacted_resources.slice(0, 4).map((arn) => (
                <span key={arn} className="badge badge--attack" style={{ fontSize: '0.55rem' }}>
                  <AwsRef value={arn} label={truncateArn(arn, 30)} />
                </span>
              ))}
              {hypothesis.impacted_resources.length > 4 && (
                <span className="badge badge--unverified" style={{ fontSize: '0.55rem' }}>
                  +{hypothesis.impacted_resources.length - 4} more
                </span>
              )}
            </div>
          </div>
        )}

        {hypothesis.unknowns.length > 0 && (
          <div className="hypothesis-bar__field">
            <span className="hypothesis-bar__field-label">Unknowns</span>
            <div className="hypothesis-bar__tags">
              {hypothesis.unknowns.map((unknown, idx) => (
                <span key={idx} className="badge badge--unverified" style={{ fontSize: '0.55rem' }}>
                  <HelpCircle size={10} style={{ verticalAlign: 'middle', marginRight: '2px' }} />
                  {unknown}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}