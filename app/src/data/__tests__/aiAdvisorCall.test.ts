// AI CONSENT (owner decision 2026-11-23): callAiAdvisor sends nothing
// without consent. Interactive calls (buttons) ask with the sheet; the
// automatic weekly review (interactive: false) never opens a sheet.
const invokeMock = jest.fn();
jest.mock('@/src/lib/supabase', () => ({
  supabase: { functions: { invoke: invokeMock } },
}));
jest.mock('@/src/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));

import { AI_CONSENT_DECLINED, callAiAdvisor } from '@/src/data/aiAdvisorCall';
import { __resetAiConsentGateForTests, registerAiConsentGate } from '@/src/ai/aiConsentGate';

const MESSAGES = [{ role: 'user' as const, content: 'hi' }];

beforeEach(() => {
  __resetAiConsentGateForTests();
  invokeMock.mockReset();
});

test('granted: the request is sent', async () => {
  registerAiConsentGate({ isGranted: () => true, prompt: async () => true });
  invokeMock.mockResolvedValue({ data: { answer: 'ok' }, error: null });
  await expect(callAiAdvisor(MESSAGES, 'en')).resolves.toEqual({ data: 'ok' });
  expect(invokeMock).toHaveBeenCalledTimes(1);
});

test('interactive and declined: the sheet asks, nothing is sent', async () => {
  const prompt = jest.fn(async () => false);
  registerAiConsentGate({ isGranted: () => false, prompt });
  const result = await callAiAdvisor(MESSAGES, 'en');
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(invokeMock).not.toHaveBeenCalled();
  expect(result.error).toEqual({ type: AI_CONSENT_DECLINED, message: 'aiConsent.declined' });
});

test('interactive: Allow in the sheet sends the request', async () => {
  registerAiConsentGate({ isGranted: () => false, prompt: async () => true });
  invokeMock.mockResolvedValue({ data: { answer: 'ok' }, error: null });
  await expect(callAiAdvisor(MESSAGES, 'en')).resolves.toEqual({ data: 'ok' });
});

test('automatic (interactive: false) without consent: no sheet, nothing sent', async () => {
  const prompt = jest.fn(async () => true);
  registerAiConsentGate({ isGranted: () => false, prompt });
  const result = await callAiAdvisor(MESSAGES, 'en', { interactive: false });
  expect(prompt).not.toHaveBeenCalled();
  expect(invokeMock).not.toHaveBeenCalled();
  expect(result.error?.type).toBe(AI_CONSENT_DECLINED);
});

test('server ai_consent_required: the app shows its own text', async () => {
  registerAiConsentGate({ isGranted: () => true, prompt: async () => true });
  invokeMock.mockResolvedValue({ data: { error: { type: 'ai_consent_required', message: 'server words' } }, error: null });
  const result = await callAiAdvisor(MESSAGES, 'en');
  expect(result.error).toEqual({ type: 'ai_consent_required', message: 'aiConsent.serverRequired' });
});
