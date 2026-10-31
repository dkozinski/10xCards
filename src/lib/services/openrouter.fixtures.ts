// OpenRouter chat-completion bodies built the way the docs describe them, so tests
// start from the documented envelope rather than from the fields the parser reads.
// Sources, checked 2026-10-28:
// - https://openrouter.ai/docs/api/reference/overview: Response, NonStreamingChoice,
//   NonChatChoice, ResponseUsage, the finish_reason values
// - https://openrouter.ai/docs/api/reference/errors-and-debugging: ErrorResponse, and
//   failures reported inside a 200 (an error body, or finish_reason "error")
// - https://openrouter.ai/openapi.json: ChatChoice.index, which the overview type omits;
//   `provider`, which the /chat/completions schema omits but the non-streaming
//   "chat.completion" body of a Batch API result carries (string | null)
// No field the docs do not show.

export interface OpenRouterError {
  code: number;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface CompletionOverrides {
  // Defaults to "stop"; null is a documented value too.
  finish_reason?: string | null;
  // A choice-level error, as on a choice that failed after producing output.
  error?: OpenRouterError;
  // Replaces the whole array, for bodies that no single-choice override can produce.
  choices?: unknown[];
}

export function completionBody(content: string | null, overrides: CompletionOverrides = {}) {
  const finishReason = overrides.finish_reason === undefined ? "stop" : overrides.finish_reason;
  const choice = {
    index: 0,
    finish_reason: finishReason,
    native_finish_reason: finishReason,
    message: { role: "assistant", content },
    ...(overrides.error ? { error: overrides.error } : {}),
  };
  return {
    id: "gen-1792972800-fixture",
    provider: "Google",
    object: "chat.completion",
    created: 1792972800,
    model: "google/gemini-3.1-flash-lite",
    choices: overrides.choices ?? [choice],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.0001 },
  };
}

// The body of an HTTP error, and of a 200 whose generation failed after a provider
// had accepted the request ("only an error object and no choices").
export function errorBody(code: number, message: string, metadata?: Record<string, unknown>) {
  const error: OpenRouterError = metadata ? { code, message, metadata } : { code, message };
  return { error };
}
