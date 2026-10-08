/**
 * Analyst provider resolution.
 *
 * The incident verdict is ALWAYS produced by the deterministic engine first. An
 * optional LLM call can only *enrich* the narrative, and only when a key is
 * configured. Any failure — missing key, network error, non-2xx, timeout, an
 * unparsable body — falls back to the deterministic summary and records a note.
 *
 * This is the fix for "external LLM APIs fail → HTTP 500": the LLM sits on a
 * best-effort side path with a hard deadline, never on the critical path.
 */

import type { IncidentHypothesis } from './types';

export interface ProviderResolution {
  provider_mode: string;
  requested_mode: string;
  notes: string[];
}

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const LLM_TIMEOUT_MS = Number(process.env.BREACHLOOP_LLM_TIMEOUT_MS ?? 6000);

export function resolveProviderMode(requested: unknown): ProviderResolution {
  const requestedMode = requested === 'anthropic' ? 'anthropic' : 'deterministic';
  const notes: string[] = [];

  if (requestedMode === 'deterministic') {
    return { provider_mode: 'deterministic', requested_mode: requestedMode, notes };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    notes.push(
      'provider_mode=anthropic requested but ANTHROPIC_API_KEY is not configured; answered with the deterministic analyst'
    );
    return { provider_mode: 'deterministic', requested_mode: requestedMode, notes };
  }

  return { provider_mode: 'anthropic', requested_mode: requestedMode, notes };
}

/**
 * Best-effort narrative enrichment. Returns the original hypothesis untouched on
 * any problem whatsoever.
 */
export async function enrichHypothesis(
  hypothesis: IncidentHypothesis,
  scenarioName: string,
  resolution: ProviderResolution
): Promise<{ hypothesis: IncidentHypothesis; notes: string[] }> {
  const notes: string[] = [];
  if (resolution.provider_mode !== 'anthropic') return { hypothesis, notes };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    notes.push('anthropic enrichment skipped: key disappeared mid-request');
    return { hypothesis, notes };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 256,
        system:
          'You are a cloud incident-response analyst. Rewrite the summary for a SOC console in two sentences, ' +
          'present tense, no hedging, no markdown. Do not change any technical claim.',
        messages: [
          {
            role: 'user',
            content: `Scenario: ${scenarioName}\nDeterministic summary: ${hypothesis.summary}`,
          },
        ],
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      notes.push(`anthropic enrichment returned HTTP ${response.status}; deterministic summary retained`);
      return { hypothesis, notes };
    }

    const body = (await response.json()) as { content?: { text?: string }[] };
    const text = (body?.content ?? [])
      .map((block) => block?.text ?? '')
      .join(' ')
      .trim();

    if (!text) {
      notes.push('anthropic enrichment returned no text; deterministic summary retained');
      return { hypothesis, notes };
    }

    // The deterministic verdict stays authoritative; the narrative is additive.
    return {
      hypothesis: {
        ...hypothesis,
        summary: `${text}\n\n[analyst: anthropic narrative over deterministic verdict] ${hypothesis.summary}`,
      },
      notes,
    };
  } catch (error) {
    const message = (error as Error)?.name === 'AbortError' ? `timed out after ${LLM_TIMEOUT_MS}ms` : (error as Error)?.message;
    notes.push(`anthropic enrichment failed (${message}); deterministic summary retained`);
    return { hypothesis, notes };
  } finally {
    clearTimeout(timer);
  }
}
