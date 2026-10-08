/**
 * ErrorBoundary — containment for the render path.
 *
 * The SOC console is a single page whose panels (graph, timeline, lab) each
 * consume derived data. Before this, one throw inside `AttackGraph` (a node that
 * vanished between render passes, a NaN coordinate) unmounted the whole tree and
 * left a blank page. Now only the affected panel degrades, with a retry.
 */

import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Shown instead of the children after a catch. */
  label?: string;
  className?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  resetKey: number;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Logged, never rethrown: a render fault must not take the console down.
    console.error(`[breachloop] ${this.props.label ?? 'panel'} failed to render`, error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState) {
    // A new payload means the data changed; give the panel another chance.
    if (prevProps.children !== this.props.children && (this.state.error || prevState.error)) {
      this.setState({ error: null, resetKey: this.state.resetKey + 1 });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="card" role="alert" style={{ borderColor: 'var(--accent-warning)' }}>
        <div className="card__body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
            <span style={{ color: 'var(--accent-warning)', fontWeight: 600, fontSize: '0.8rem' }}>
              {this.props.label ?? 'Panel'} could not be drawn
            </span>
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
            {this.state.error.message || 'Unexpected render error.'} The rest of the console is unaffected.
          </p>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => this.setState({ error: null, resetKey: this.state.resetKey + 1 })}
          >
            Re-render panel
          </button>
        </div>
      </div>
    );
  }
}
