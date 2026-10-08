/**
 * Trainer (quiz) mode — commit to a remediation, then see what the twin says.
 *
 * The pedagogical point of the lab is the broad-vs-narrow tradeoff, and the only
 * way to *learn* it is to be forced to choose before the verdict is visible. So
 * this module splits the pipeline output in two:
 *
 *   • `buildQuizPreview` — everything a responder legitimately has before acting:
 *     the hypothesis, the attack path, the events, the business workflows that are
 *     running, and the candidate fixes by title/type/target. It carries **no** twin
 *     status, no candidate `description`, no `is_broad`, and no `ground_truth`.
 *   • `gradeQuizAnswer` — after the learner commits: the twin's real verdict for
 *     every candidate, the pack's expected labels, and why.
 *
 * Grading is deliberately per question type. In an attack pack the correct option
 * is the one the twin marks `verified` (path closed, workflows intact). In a benign
 * pack the correct option is `no-action` and it is graded on `scenario_type` alone —
 * NOT on twin status, because a benign pack can legitimately report a `verified`
 * narrow fix (there was simply nothing to remediate), which would otherwise make
 * two options correct.
 *
 * Nothing is cached or persisted: every preview and every grade recomputes from the
 * pack, so there is no server-side state to leak and no session to lose on a
 * stateless platform.
 */

import type {
  AttackPath,
  BusinessWorkflow,
  CanonicalEvent,
  EvidenceReport,
  IncidentHypothesis,
  RemediationCandidate,
  ScenarioData,
  SimulationResult,
} from '@/lib/engine/types';

/** The one option that exists only for benign packs. */
export const NO_ACTION_OPTION = 'no-action';

export interface QuizOption {
  id: string;
  kind: 'remediation' | 'no-action';
  title: string;
  /** Action family the fix belongs to, e.g. `attach_inline_deny`. */
  action_type?: string;
  /** What it would be applied to. Rendered as an AwsRef link. */
  target_arn?: string;
}

export interface QuizPreview {
  scenario_id: string;
  name: string;
  description: string;
  scenario_type: 'attack' | 'benign';
  question: string;
  instruction: string;
  options: QuizOption[];
  hypothesis: IncidentHypothesis;
  attack_path: AttackPath;
  events: CanonicalEvent[];
  workflows: BusinessWorkflow[];
  /** The engine's honesty flags travel with the quiz, not just with reports. */
  synthetic: true;
  warnings: string[];
}

export interface QuizRevealedCandidate {
  id: string;
  title: string;
  action_type: string;
  target_arn: string;
  description: string;
  is_broad: boolean;
  status: SimulationResult['status'] | 'n/a';
  reason: string;
  path_closed: boolean;
  broken_workflows: string[];
  workflows_intact: boolean;
}

export interface QuizGrade {
  scenario_id: string;
  option_id: string;
  correct: boolean;
  /**
   * false when the twin could not evaluate the pack at all. `correct` is then
   * meaningless and the attempt must not be scored — an infrastructure failure is
   * not a wrong answer.
   */
  graded?: boolean;
  /** Graded question type, so the UI can word the result honestly. */
  kind: 'remediation' | 'no-action';
  explanation: string;
  revealed: {
    scenario_type: 'attack' | 'benign';
    candidates: QuizRevealedCandidate[];
    /** Only ever returned post-commit: this is the answer key. */
    expected: Record<string, unknown>;
    correct_option_ids: string[];
  };
  synthetic: true;
  warnings: string[];
}

/** Titles are the only pre-commit prose about a fix — the description is the giveaway. */
function optionFromCandidate(candidate: RemediationCandidate): QuizOption {
  return {
    id: candidate.id,
    kind: 'remediation',
    title: candidate.title,
    action_type: candidate.remediation_type,
    target_arn: candidate.target_arn,
  };
}

function questionFor(scenario: ScenarioData): { question: string; instruction: string } {
  if (scenario.scenario_type === 'benign') {
    return {
      question: 'Is there an incident here, and what do you do about it?',
      instruction:
        'Pick the response you would actually take. Applying a control to legitimate activity is itself a finding — it costs you the workflow.',
    };
  }
  return {
    question: 'Which response stops this path without taking production down with it?',
    instruction:
      'One of these closes the reachability edge and leaves every business workflow running. The other may well stop the attacker too — at a price the twin will show you after you commit.',
  };
}

export function quizScenarioType(scenario: ScenarioData): 'attack' | 'benign' {
  return scenario.scenario_type === 'benign' ? 'benign' : 'attack';
}

export function buildQuizPreview(scenario: ScenarioData, report: EvidenceReport): QuizPreview {
  const { question, instruction } = questionFor(scenario);
  const scenarioType = quizScenarioType(scenario);
  const candidates = Array.isArray(scenario.candidate_remediations) ? scenario.candidate_remediations : [];
  const options: QuizOption[] = candidates.map(optionFromCandidate);
  if (scenarioType === 'benign') {
    options.push({
      id: NO_ACTION_OPTION,
      kind: 'no-action',
      title: 'No change — close as legitimate operational activity',
    });
  }

  return {
    scenario_id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    scenario_type: scenarioType,
    question,
    instruction,
    options,
    hypothesis: report.hypothesis,
    attack_path: report.attack_path,
    events: Array.isArray(report.events) ? report.events : [],
    // Workflow names and required actions are what a responder can look up before
    // acting; whether a given fix breaks them is exactly what the twin answers after.
    workflows: Array.isArray(scenario.workflows) ? scenario.workflows : [],
    synthetic: true,
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
  };
}

function revealCandidate(
  candidate: RemediationCandidate,
  simulation: SimulationResult | undefined
): QuizRevealedCandidate {
  const results = Array.isArray(simulation?.workflow_results) ? simulation.workflow_results : [];
  return {
    id: candidate.id,
    title: candidate.title,
    action_type: candidate.remediation_type,
    target_arn: candidate.target_arn,
    description: candidate.description,
    is_broad: candidate.is_broad === true,
    status: simulation?.status ?? 'n/a',
    reason: simulation?.reason ?? 'The twin produced no verdict for this candidate.',
    path_closed: simulation ? simulation.after_reachability?.is_reachable !== true : false,
    broken_workflows: results.filter((workflow) => !workflow.is_operational).map((workflow) => workflow.workflow_name),
    workflows_intact: results.length > 0 && results.every((workflow) => workflow.is_operational),
  };
}

function explanationFor(
  benign: boolean,
  chosen: QuizRevealedCandidate | null,
  correct: boolean,
  anyPathBlocked: boolean
): string {
  if (benign && correct) {
    return 'Correct. Nothing here needed a control: the activity is expected operations, and the right output is a note, not a change. This is the false-positive half of the job — most "suspicious" CloudTrail lines are exactly this.';
  }
  if (benign && !correct) {
    return 'This was benign operational activity, so a remediation is the wrong answer even when the twin can describe what the change would do. Revoking access to legitimate work is an outage, not a fix.';
  }
  if (correct && chosen) {
    return `Correct — and for the right reason. The twin closed the reachability edge (${chosen.target_arn}) while every business workflow stayed operational. That is the whole skill: scope the denial to the permission, not to the identity.`;
  }
  if (chosen) {
    const broken = chosen.broken_workflows.length > 0 ? chosen.broken_workflows.join(', ') : 'no workflow the twin models';
    const stopped = chosen.path_closed ? 'It does block the attacker' : 'It does not even block the attacker';
    return `${stopped} — but it also takes down ${broken}. A fix that costs the business its workload is an escalation call for an owner, not a default action. ${anyPathBlocked ? 'Another option here closed the same path with the workflows intact.' : ''}`.trim();
  }
  return 'Closing an active incident without touching anything leaves the path open: the twin still reaches the target from the compromised identity.';
}

/** Which options are correct — computed the same way for grading and for the reveal. */
function correctOptionIds(
  scenario: ScenarioData,
  simulations: Map<string, SimulationResult>
): string[] {
  if (quizScenarioType(scenario) === 'benign') return [NO_ACTION_OPTION];
  const candidates = Array.isArray(scenario.candidate_remediations) ? scenario.candidate_remediations : [];
  return candidates
    .filter((candidate) => simulations.get(candidate.id)?.status === 'verified')
    .map((candidate) => candidate.id);
}

export function gradeQuizAnswer(scenario: ScenarioData, report: EvidenceReport, optionId: string): QuizGrade {
  const scenarioType = quizScenarioType(scenario);
  const benign = scenarioType === 'benign';
  const simulations = new Map<string, SimulationResult>(
    (Array.isArray(report.simulations) ? report.simulations : []).map((simulation) => [simulation.remediation_id, simulation])
  );
  const candidates = Array.isArray(scenario.candidate_remediations) ? scenario.candidate_remediations : [];
  const revealed = candidates.map((candidate) => revealCandidate(candidate, simulations.get(candidate.id)));
  const correctIds = correctOptionIds(scenario, simulations);
  const chosen = revealed.find((candidate) => candidate.id === optionId) ?? null;
  const correct = correctIds.includes(optionId);
  const anyPathBlocked = revealed.some((candidate) => candidate.path_closed);

  return {
    scenario_id: scenario.id,
    option_id: optionId,
    correct,
    kind: optionId === NO_ACTION_OPTION ? 'no-action' : 'remediation',
    explanation: explanationFor(benign, chosen, correct, anyPathBlocked),
    revealed: {
      scenario_type: scenarioType,
      candidates: revealed,
      // Post-commit only. `buildQuizPreview` never reads this field.
      expected: scenario.ground_truth ?? {},
      correct_option_ids: correctIds,
    },
    synthetic: true,
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
  };
}
