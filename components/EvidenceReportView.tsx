/**
 * EvidenceReportView - JSON evidence report viewer and download handler
 */

import React, { useState } from 'react';
import { Download, Copy, Check, Eye, EyeOff } from 'lucide-react';
import type { EvidenceReportView } from '@/lib/types';

interface EvidenceReportViewProps {
  report: EvidenceReportView | null;
  onDownload: () => void;
  className?: string;
}

export function EvidenceReportView({
  report,
  onDownload,
  className = '',
}: EvidenceReportViewProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (!report) {
    return (
      <div className={`card ${className}`}>
        <div className="card__header">
          <div className="card__title">
            <Eye className="card__title-icon" size={18} />
            Evidence Report
          </div>
        </div>
        <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)' }}>
          <p style={{ fontSize: '0.8rem' }}>No report available. Run an incident analysis to generate a report.</p>
        </div>
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const reportJson = JSON.stringify(report, null, 2);

  return (
    <div className={`card ${className}`}>
      <div className="card__header">
        <div className="card__title">
          <Eye className="card__title-icon" size={18} />
          Evidence Report
        </div>
        <div className="card__actions">
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand report' : 'Collapse report'}
          >
            {collapsed ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={handleCopy}
            aria-label="Copy report to clipboard"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            className="btn btn--secondary btn--sm"
            onClick={onDownload}
            aria-label="Download report as JSON"
          >
            <Download size={14} />
            Download
          </button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ padding: 'var(--space-4)' }}>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
              Report Metadata
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--bg-glass-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Report ID</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{report.report_id}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Scenario</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{report.scenario_name}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Scenario Type</div>
                <div>
                  <span className={`badge ${report.scenario_type === 'attack' ? 'badge--attack' : 'badge--benign'}`} style={{ fontSize: '0.6rem' }}>
                    {report.scenario_type.toUpperCase()}
                  </span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Timestamp</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {new Date(report.timestamp).toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Provider</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                  {report.provider_mode}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Candidates</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                  {report.candidates.length} evaluated
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
              Full JSON Report
            </h3>
            <div
              style={{
                background: 'var(--bg-glass-strong)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                maxHeight: '400px',
                overflowY: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
                lineHeight: 1.5,
                color: 'var(--text-secondary)',
              }}
            >
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {reportJson}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
