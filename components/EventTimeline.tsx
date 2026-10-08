/**
 * EventTimeline - Chronological CloudTrail audit log inspector
 */

import React, { useState } from 'react';
import { X, Search, AlertTriangle } from 'lucide-react';
import { AwsRef } from '@/components/AwsRef';
import type { CanonicalEvent } from '@/lib/types';

interface EventTimelineProps {
  events: CanonicalEvent[];
  attackPathEventIds: Set<string>;
  formatTimestamp: (isoString: string) => string;
  truncateArn: (arn: string) => string;
  className?: string;
}

/** raw_evidence is an open bag; stringify before rendering or it can be an object. */
const text = (value: unknown): string =>
  value === null || value === undefined ? '' : typeof value === 'string' ? value : String(value);

export function EventTimeline({
  events,
  attackPathEventIds,
  formatTimestamp,
  truncateArn,
  className = '',
}: EventTimelineProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [showOnlyAttack, setShowOnlyAttack] = useState(false);

  const safeEvents = Array.isArray(events) ? events : [];
  const attackIds = attackPathEventIds instanceof Set ? attackPathEventIds : new Set();

  const filteredEvents = safeEvents.filter(event => {
    if (showOnlyAttack && !attackIds.has(event?.event_id)) return false;
    if (!filterText) return true;
    const search = filterText.toLowerCase();
    const has = (value: unknown) => text(value).toLowerCase().includes(search);
    return (
      has(event?.event_id) ||
      has(event?.action) ||
      has(event?.service) ||
      has(event?.actor_arn) ||
      has(event?.target_arn)
    );
  });

  const isAttackEvent = (eventId: string) => attackIds.has(eventId);

  return (
    <div className={`card ${className}`} style={{ minHeight: '400px', overflowY: 'auto' }}>
      <div className="card__header">
        <div className="card__title">
          <Search className="card__title-icon" size={18} />
          Audit Timeline
        </div>
        <div className="card__actions">
          <input
            type="text"
            placeholder="Filter events..."
            value={filterText}
            onChange={e => setFilterText((e.target as HTMLInputElement).value)}
            style={{ padding: 'var(--space-1)', fontSize: '0.75rem', background: 'var(--bg-glass-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
          />
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setShowOnlyAttack(!showOnlyAttack)}
            aria-label={showOnlyAttack ? 'Show all events' : 'Show attack events only'}
          >
            {showOnlyAttack ? (
              <AlertTriangle size={14} />
            ) : (
              <Search size={14} />
            )}
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setSelectedEventId(null)}
            aria-label="Clear selection"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="timeline" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-4)' }}>
        {filteredEvents.map((event) => (
          <React.Fragment key={event.event_id}>
            <div
              className={`timeline__item ${isAttackEvent(event.event_id) ? 'timeline__item--attack' : 'timeline__item--benign'} ${selectedEventId === event.event_id ? 'timeline__item--selected' : ''}`}
              onClick={() => setSelectedEventId(selectedEventId === event.event_id ? null : event.event_id)}
              style={{ cursor: 'pointer', transition: 'all var(--motion-fast) var(--ease-out)' }}
            >
              <div className="timeline__item__header">
                <div className="timeline__time">{formatTimestamp(event.event_time)}</div>
                <div className="timeline__event-type" title={event.action}>
                  {isAttackEvent(event.event_id) ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--accent-critical-soft)', padding: '2px 4px', borderRadius: '4px', fontSize: '0.6rem' }}>
                      <AlertTriangle size={10} />
                      Attack
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{event.action}</span>
                  )}
                </div>
              </div>

              <div className="timeline__item__details">
                <div className="timeline__actor">
                  <AwsRef value={event.actor_arn} label={truncateArn(event.actor_arn)} />
                </div>
                <div className="timeline__source-ip">
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{text(event.raw_evidence?.sourceIPAddress) || '—'}</span>
                </div>
              </div>

              <div className="timeline__item__resource">
                <span className="timeline__resource-label">Resource:</span>
                <span className="timeline__resource-value">
                  {event.target_arn ? <AwsRef value={event.target_arn} label={truncateArn(event.target_arn)} /> : '—'}
                </span>
              </div>

              <div className="timeline__evidence">
                <span className="timeline__evidence-label">Evidence ID:</span>
                <span className="timeline__evidence-value">{event.event_id.slice(0, 8)}…</span>
              </div>
            </div>

            {selectedEventId === event.event_id && (
              <div className="timeline__detail-panel" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', background: 'var(--bg-glass-strong)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div className="detail-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                  <div className="event-type">
                    <span className={`badge ${isAttackEvent(event.event_id) ? 'badge--attack' : 'badge--benign'}`}>
                      {isAttackEvent(event.event_id) ? 'ATTACK' : 'BENIGN'}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedEventId(null)}
                    className="btn btn--ghost btn--sm"
                    aria-label="Close details"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
                  <DetailField label="Event ID" value={event.event_id} />
                  <DetailField label="Timestamp (UTC)" value={formatTimestamp(event.event_time)} />
                  <DetailField label="Action" value={event.action} />
                  <DetailField label="Service" value={event.service} />
                  <DetailField label="Actor ARN" value={<AwsRef value={event.actor_arn} />} />
                  <DetailField label="Source IP" value={text(event.raw_evidence?.sourceIPAddress) || '—'} />
                  <DetailField label="User Agent" value={text(event.raw_evidence?.userAgent) || '—'} />
                  {Boolean(event.raw_evidence?.errorCode) && (
                    <DetailField label="Error Code" value={text(event.raw_evidence?.errorCode)} />
                  )}
                  {Boolean(event.raw_evidence?.errorMessage) && (
                    <DetailField label="Error Message" value={text(event.raw_evidence?.errorMessage)} />
                  )}
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

interface DetailFieldProps {
  label: string;
  /** Node so ARNs can render as AwsRef links rather than flat text. */
  value: React.ReactNode;
}

function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div className="timeline__field">
      <span className="timeline__field-label">{label}</span>
      <span className="timeline__field-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  );
}