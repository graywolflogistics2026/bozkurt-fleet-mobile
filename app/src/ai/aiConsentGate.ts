// AI CONSENT GATE REGISTRY (owner decision 2026-11-23). The one place every
// AI call asks "may I send this?". AiConsentProvider (mounted once at the
// app root) registers how to read the current consent and how to open the
// just-in-time sheet; data-layer code (callAiImport, callAiAdvisor, the
// reader job calls) and screens only call the functions below, so a new AI
// call site cannot skip the question by accident.
//
// Fail closed: with no provider registered nothing may be sent.

export type AiConsentGate = {
  isGranted: () => boolean;
  // Opens the just-in-time sheet; resolves true only on Allow.
  prompt: () => Promise<boolean>;
};

let gate: AiConsentGate | null = null;
let pending: Promise<boolean> | null = null;

export function registerAiConsentGate(next: AiConsentGate): () => void {
  gate = next;
  return () => {
    if (gate === next) gate = null;
  };
}

// Silent check (never opens a sheet). For automatic work, e.g. the AI
// Coach weekly review on Home and the background resume of an import job.
export function isAiConsentGranted(): boolean {
  return gate ? gate.isGranted() : false;
}

// Interactive check: true at once when granted, otherwise opens the sheet
// (one sheet at a time; parallel callers share the same answer).
export async function requestAiConsent(): Promise<boolean> {
  if (!gate) return false;
  if (gate.isGranted()) return true;
  if (!pending) {
    pending = gate.prompt().finally(() => {
      pending = null;
    });
  }
  return pending;
}

export class AiConsentDeclinedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConsentDeclinedError';
  }
}

// Interactive check that throws a friendly error when the user says no.
export async function requireAiConsent(declinedMessage: string): Promise<void> {
  if (!(await requestAiConsent())) throw new AiConsentDeclinedError(declinedMessage);
}

export function isAiConsentDeclinedError(err: unknown): err is AiConsentDeclinedError {
  return err instanceof Error && err.name === 'AiConsentDeclinedError';
}

// Test-only reset.
export function __resetAiConsentGateForTests(): void {
  gate = null;
  pending = null;
}
