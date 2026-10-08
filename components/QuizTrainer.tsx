/**
 * QuizTrainer — commit to a response, then find out what the twin says.
 *
 * The lab's whole lesson is broad-vs-narrow remediation, and it can only be
 * learned by deciding before the verdict is visible. So this panel is fed
 * `/api/quiz/preview` (hypothesis, path, events, running workflows, candidate
 * titles — no verdicts, no descriptions, no `is_broad`, no answer key) and only
 * asks `/api/quiz/grade` once the learner locks an answer in.
 *
 * The score lives in the browser (localStorage), not on the server: this is a
 * study aid, not an exam proctor, and a local score keeps the API stateless.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Award, CheckCircle, RotateCcw, ShieldQuestion, Target, XCircle } from 'lucide-react';
import { AwsRef, shortArn } from '@/components/AwsRef';
import { EventTimeline } from '@/components/EventTimeline';
import type { QuizGrade, QuizPreview } from '@/lib/types';

export interface TrainerScore {
  answered: number;
  correct: number;
  streak: number;
  bestStreak: number;
  results: Record<string, 'correct' | 'wrong'>;
}

export const EMPTY_SCORE: TrainerScore = { answered: 0, correct: 0, streak: 0, bestStreak: 0, results: {} };
const SCORE_KEY = 'breachloop.trainer.v1';

/** Grade payload as served by the route (`graded` is added there, not in the type). */
export type TrainerGrade = QuizGrade & { graded?: boolean };

interface QuizTrainerProps {
  preview: QuizPreview | null;
  grade: TrainerGrade | null;
  loading: boolean;
  error: string | null;
  score: TrainerScore;
  /** Called with the chosen option id; the parent does the grading request. */
  onAnswer: (optionId: string) => void;
  onRerun: () => void;
  onPickAnother: () => void;
  onResetScore: () => void;
  formatTimestamp: (iso: string) => string;
  truncateArn: (arn: string, maxLength?: number) => string;
}

/** Local-only score: this is a study aid, not a proctored exam. */
export function loadTrainerScore(storage: Pick<Storage, 'getItem'> | null | undefined = typeof window !== 'undefined' ? window.localStorage : null): TrainerScore {
  if (!storage) return EMPTY_SCORE;
  try {
    const raw = storage.getItem(SCORE_KEY);
    if (!raw) return EMPTY_SCORE;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const count = (value: unknown) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0);
    const results: TrainerScore['results'] = {};
    if (parsed['results'] && typeof parsed['results'] === 'object') {
      for (const [key, value] of Object.entries(parsed['results'] as Record<string, unknown>)) {
        if (value === 'correct' || value === 'wrong') results[key] = value;
      }
    }
    const correct = Math.min(count(parsed['correct']), count(parsed['answered']));
    return {
      answered: count(parsed['answered']),
      correct,
      streak: count(parsed['streak']),
      bestStreak: Math.max(count(parsed['bestStreak']), count(parsed['streak'])),
      results,
    };
  } catch {
    // A hostile or half-written localStorage entry must not break the panel.
    return EMPTY_SCORE;
  }
}

export function saveTrainerScore(score: TrainerScore, storage: Pick<Storage, 'setItem'> | null | undefined = typeof window !== 'undefined' ? window.localStorage : null): void {
  try {
    storage?.setItem(SCORE_KEY, JSON.stringify(score));
  } catch {
    /* private mode or a full quota: the score simply stays in memory */
  }
}

function accuracyOf(score: TrainerScore): number {
  return score.answered === 0 ? 0 : Math.round((score.correct / score.answered) * 100);
}

export function QuizTrainer({
  preview,
  grade,
  loading,
  error,
  score,
  onAnswer,
  onRerun,
  onPickAnother,
  onResetScore,
  formatTimestamp,
  truncateArn,
}: QuizTrainerProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const optionsRef = useRef<HTMLFieldSetElement>(null);

  // A new pack means a new question: drop both the pick and the previous verdict.
  useEffect(() => {
    setSelected(null);
  }, [preview?.scenario_id]);

  const answered = Boolean(grade);
  const options = useMemo(() => (Array.isArray(preview?.options) ? preview.options : []), [preview]);
  const attackPathEventIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of preview?.attack_path?.evidence_event_ids ?? []) {
      if (typeof id === 'string') ids.add(id);
    }
    return ids;
  }, [preview]);

  const handleKeyNav = useCallback((event: React.KeyboardEvent<HTMLFieldSetElement>) => {
    // Roving focus for the option list: ArrowUp/Down move the selection, matching
    // the launch pad's keyboard model.
    if (options.length === 0) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const current = options.findIndex((option) => option.id === selected);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = (current === -1 ? (step > 0 ? 0 : options.length - 1) : (current + step + options.length) % options.length);
    setSelected(options[next].id);
    const inputs = optionsRef.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    inputs?.[next]?.focus();
  }, [options, selected]);

  if (loading) {
    return (
      <section className="quiz quiz--loading" aria-live="polite" aria-busy="true">
        <span className="quiz__spinner" aria-hidden="true" />
        <p className="quiz__loading-text">Rebuilding the incident for the trainer…</p>
      </section>
    );
  }

  if (error && !preview) {
    return (
      <section className="quiz quiz--error" role="alert">
        <h2 className="quiz__title">Trainer unavailable</h2>
        <p className="quiz__lede">{error}</p>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onRerun}>
          <RotateCcw size={14} /> Try again
        </button>
      </section>
    );
  }

  if (!preview) {
    return (
      <section className="quiz quiz--idle">
        <div className="quiz__idle-icon" aria-hidden="true">
          <ShieldQuestion size={22} />
        </div>
        <p className="quiz__eyebrow">Trainer mode</p>
        <h2 className="quiz__title">Pick a cloud, then decide before the twin does</h2>
        <p className="quiz__lede">
          Every pack becomes one question: given the evidence, what would you actually apply? The verdict is
          withheld until you commit — that delay is the exercise.
        </p>
        <button type="button" className="btn btn--primary btn--sm" onClick={onPickAnother}>
          Choose a target
        </button>
      </section>
    );
  }

  const accuracy = accuracyOf(score);
  const resultTone = !grade ? '' : grade.graded === false ? 'ungraded' : grade.correct ? 'correct' : 'wrong';

  return (
    <section className="quiz" aria-label={`Trainer: ${preview.name}`}>
      <header className="quiz__head">
        <div className="quiz__heading">
          <p className="quiz__eyebrow">
            <span className={`quiz__kind quiz__kind--${preview.scenario_type}`}>
              {preview.scenario_type === 'attack' ? 'Attack pack' : 'Benign pack'}
            </span>
            <span className="quiz__synthetic" title="Synthetic scenario pack — the identifiers here live in AWS's documentation example account, so nothing is being tested against real infrastructure.">
              synthetic
            </span>
          </p>
          <h2 className="quiz__title">{preview.name}</h2>
          <p className="quiz__lede">{preview.question}</p>
          <p className="quiz__instruction">{preview.instruction}</p>
        </div>

        <div className="quiz__score" aria-label={`Score: ${score.correct} of ${score.answered} correct, ${accuracy}%, streak ${score.streak}`}>
          <span className="quiz__score-value">
            {score.correct}
            <span className="quiz__score-total">/{score.answered}</span>
          </span>
          <span className="quiz__score-label">{accuracy}% · streak {score.streak}{score.bestStreak > 0 ? ` (best ${score.bestStreak})` : ''}</span>
        </div>
      </header>

      <div className="quiz__body">
        <div className="quiz__evidence">
          <div className="quiz__panel">
            <h3 className="quiz__panel-title">
              <Target size={14} aria-hidden="true" /> What the evidence says
            </h3>
            <p className="quiz__hypothesis">{preview.hypothesis?.summary || 'No hypothesis was reconstructed.'}</p>
            <dl className="quiz__facts">
              <div>
                <dt>Vector</dt>
                <dd>{preview.hypothesis?.attack_vector || '—'}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{Math.round((preview.hypothesis?.confidence ?? 0) * 100)}%</dd>
              </div>
              <div>
                <dt>Path length</dt>
                <dd>{preview.attack_path?.steps?.length ?? 0} step(s)</dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd>{Array.isArray(preview.events) ? preview.events.length : 0}</dd>
              </div>
            </dl>

            <ol className="quiz__path">
              {(preview.attack_path?.steps ?? []).map((step) => (
                <li key={`${step.step_number}-${step.evidence_event_id}`} className="quiz__path-step">
                  <AwsRef value={step.source_node} label={shortArn(step.source_node)} />
                  <span className="quiz__path-action">{step.action}</span>
                  <AwsRef value={step.target_node} label={shortArn(step.target_node)} />
                </li>
              ))}
              {(preview.attack_path?.steps?.length ?? 0) === 0 && (
                <li className="quiz__path-empty">The twin found no attacker path to the sensitive resource.</li>
              )}
            </ol>
          </div>

          <div className="quiz__panel">
            <h3 className="quiz__panel-title">Running workflows you would affect</h3>
            <ul className="quiz__workflows">
              {preview.workflows.map((workflow) => (
                <li key={workflow.id}>
                  <span className="quiz__workflow-name">{workflow.name}</span>
                  <span className="quiz__workflow-crit">{workflow.criticality}</span>
                  <span className="quiz__workflow-action">{workflow.required_action}</span>
                </li>
              ))}
              {preview.workflows.length === 0 && <li className="quiz__path-empty">No business workflow declared in this pack.</li>}
            </ul>
          </div>

          <EventTimeline
            events={preview.events}
            attackPathEventIds={attackPathEventIds}
            formatTimestamp={formatTimestamp}
            truncateArn={truncateArn}
            className="quiz__timeline"
          />
        </div>

        <div className="quiz__answer">
          <fieldset
            className="quiz__options"
            ref={optionsRef}
            onKeyDown={handleKeyNav}
            disabled={answered || loading}
            aria-label="Candidate responses"
          >
            <legend className="quiz__legend">{answered ? 'Your answer' : 'Choose one response'}</legend>
            {options.map((option, index) => {
              const checked = selected === option.id;
              const pickedAfterAnswer = answered && grade?.option_id === option.id;
              const wasRight = answered && Array.isArray(grade?.revealed?.correct_option_ids)
                ? grade.revealed.correct_option_ids.includes(option.id)
                : false;
              return (
                <label
                  key={option.id}
                  className={[
                    'quiz__option',
                    checked && !answered ? 'quiz__option--selected' : '',
                    pickedAfterAnswer ? 'quiz__option--picked' : '',
                    answered && wasRight ? 'quiz__option--truth' : '',
                    answered && option.kind === 'no-action' ? 'quiz__option--no-action' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <input
                    type="radio"
                    name="quiz-option"
                    value={option.id}
                    checked={checked}
                    onChange={() => setSelected(option.id)}
                    onClick={() => {
                      if (!answered) setSelected(option.id);
                    }}
                  />
                  <span className="quiz__option-index" aria-hidden="true">{index + 1}</span>
                  <span className="quiz__option-text">
                    <span className="quiz__option-title">{option.title}</span>
                    {option.action_type && (
                      <span className="quiz__option-meta">
                        <span className="chip">{option.action_type}</span>
                        {option.target_arn && (
                          <span className="quiz__option-target">
                            on <AwsRef value={option.target_arn} label={shortArn(option.target_arn)} />
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  {answered && (
                    <span className="quiz__option-mark" aria-hidden="true">
                      {wasRight ? <CheckCircle size={15} /> : pickedAfterAnswer ? <XCircle size={15} /> : null}
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>

          {!answered ? (
            <button
              type="button"
              className="btn btn--primary quiz__lockin"
              disabled={!selected || loading}
              onClick={() => selected && onAnswer(selected)}
            >
              Lock in answer
            </button>
          ) : (
            <div className={`quiz__verdict ${resultTone ? `quiz__verdict--${resultTone}` : ''}`} role="status" aria-live="polite">
              <p className="quiz__verdict-headline">
                {grade?.graded === false
                  ? 'Not scored'
                  : grade?.correct
                    ? 'Correct call'
                    : 'Not the call the twin would make'}
              </p>
              <p className="quiz__verdict-text">{grade?.explanation}</p>

              <ul className="quiz__reveal">
                {(grade?.revealed?.candidates ?? []).map((candidate) => (
                  <li key={candidate.id} className={`quiz__reveal-item quiz__reveal-item--${candidate.status}`}>
                    <span className="quiz__reveal-status">{candidate.status}</span>
                    <span className="quiz__reveal-title">{candidate.title}</span>
                    <span className="quiz__reveal-broad">{candidate.is_broad ? 'broad' : 'scoped'}</span>
                    <p className="quiz__reveal-desc">{candidate.description}</p>
                    <p className="quiz__reveal-reason">{candidate.reason}</p>
                    {candidate.broken_workflows.length > 0 && (
                      <p className="quiz__reveal-broken">Breaks: {candidate.broken_workflows.join(', ')}</p>
                    )}
                  </li>
                ))}
              </ul>

              <details className="quiz__answerkey">
                <summary>Answer key from the pack</summary>
                <pre className="quiz__answerkey-json">{JSON.stringify(grade?.revealed?.expected ?? {}, null, 2)}</pre>
              </details>

              <div className="quiz__actions">
                <button type="button" className="btn btn--ghost btn--sm" onClick={onRerun}>
                  <RotateCcw size={13} /> This pack again
                </button>
                <button type="button" className="btn btn--secondary btn--sm" onClick={onPickAnother}>
                  Next target
                </button>
                {score.answered > 0 && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={onResetScore}>
                    <Award size={13} /> Reset score
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {Array.isArray(preview.warnings) && preview.warnings.length > 0 && (
        <footer className="quiz__footnote">
          {preview.warnings.map((warning) => (
            <span key={warning} className="quiz__warning">{warning}</span>
          ))}
        </footer>
      )}
    </section>
  );
}

export default QuizTrainer;
