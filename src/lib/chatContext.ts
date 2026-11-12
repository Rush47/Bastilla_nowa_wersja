import type { Message } from './types';

// Only completed conversation turns belong in model context. Pending replies and
// diagnostics must not be repeated to the model as if they were its own answers.
export function chatContext(history: Message[]) {
  return history.filter((message) =>
    message.role === 'user' ||
    ((message.role === 'assistant' || message.role === 'agent') && message.status === 'delivered'),
  ).slice(-10);
}

export function geminiModel(env: Record<string, string | undefined> = process.env) {
  return env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
}
