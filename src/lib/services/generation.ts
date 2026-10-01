import { z } from "zod";
import { BACK_MAX, FRONT_MAX, createFlashcardSchema } from "@/lib/validation/flashcard";
import { MAX_PROPOSALS, modelOutputSchema } from "@/lib/validation/generation";
import type { FlashcardProposalDto, GenerateProposalsCommand } from "@/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Primary first; OpenRouter falls back down the list. Both have ZDR endpoints
// that support structured outputs (research.md §5).
export const GENERATION_MODELS = ["google/gemini-3.1-flash-lite", "mistralai/mistral-small-2603"];

// Coupled: ~3,500 tokens at ~70 tok/s is ~50 s, inside the 60 s abort, which in
// turn stays well under the ~100 s CDN idle timeout. Change one, re-check both.
const MAX_TOKENS = 3500;
const DEFAULT_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = [
  "You turn study material into flashcards for spaced repetition.",
  `Extract at most ${MAX_PROPOSALS} of the most important concepts from the user's text, only as many as the text genuinely supports.`,
  `Each card is one atomic question (front, at most ${FRONT_MAX} characters) and its answer (back, at most ${BACK_MAX} characters).`,
  "Write the cards in the same language as the text. No numbering, no markdown, no references to 'the text'.",
].join(" ");

// zod 4 emits a top-level "$schema" key, which some structured-output endpoints
// reject as unknown. Everything else (additionalProperties: false, maxItems) stays.
const responseSchema: Record<string, unknown> = z.toJSONSchema(modelOutputSchema);
delete responseSchema.$schema;

export type GenerationErrorKind =
  | "timeout"
  | "upstream_http"
  | "upstream_body_error"
  | "invalid_output"
  | "no_valid_cards";

// Fixed messages only: upstream error text and model output can echo the user's
// source text, and error messages end up in logs.
const MESSAGES: Record<GenerationErrorKind, string> = {
  timeout: "Generation timed out",
  upstream_http: "Generation service returned an error status",
  upstream_body_error: "Generation service reported an error",
  invalid_output: "Generation returned unreadable output",
  no_valid_cards: "Generation returned no valid flashcards",
};

export class GenerationError extends Error {
  constructor(
    readonly kind: GenerationErrorKind,
    readonly status?: number,
  ) {
    super(MESSAGES[kind]);
    this.name = "GenerationError";
  }
}

export interface GenerationUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}

export interface GenerationResult {
  proposals: FlashcardProposalDto[];
  meta: {
    // cards returned by the model but not proposed: invalid, or beyond MAX_PROPOSALS
    dropped: number;
    latencyMs: number;
    usage?: GenerationUsage;
  };
}

export interface GenerationOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const completionSchema = z.object({
  error: z.unknown().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
  usage: z.unknown().optional(),
});

// Parsed on its own: usage is informational and must never fail a good completion.
const usageSchema = z.object({ prompt_tokens: z.number(), completion_tokens: z.number(), cost: z.number() }).partial();

// Types only: the per-card rules live in createFlashcardSchema, and a model that
// overshoots MAX_PROPOSALS is capped rather than rejected.
const rawOutputSchema = z.object({ cards: z.array(z.unknown()) });

export async function generateProposals(
  apiKey: string,
  cmd: GenerateProposalsCommand,
  opts: GenerationOptions = {},
): Promise<GenerationResult> {
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const started = Date.now();
  const controller = new AbortController();
  // setTimeout rather than AbortSignal.timeout(): the latter keeps the Worker's
  // request context alive for the full duration even after we finish.
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let body: unknown;
  try {
    let response: Response;
    try {
      response = await doFetch(OPENROUTER_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "10xCards",
          "X-OpenRouter-App-Visibility": "hidden",
        },
        body: JSON.stringify({
          models: GENERATION_MODELS,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: cmd.text },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "flashcards", strict: true, schema: responseSchema },
          },
          // Zero data retention: only endpoints that store nothing, never ones that train.
          provider: { zdr: true, data_collection: "deny", require_parameters: true },
          max_tokens: MAX_TOKENS,
        }),
      });
    } catch {
      throw new GenerationError(controller.signal.aborted ? "timeout" : "upstream_http");
    }

    if (!response.ok) {
      // cancel() rejects if the abort already errored the stream; the status is what matters.
      await response.body?.cancel().catch(() => undefined);
      throw new GenerationError("upstream_http", response.status);
    }

    try {
      body = await response.json();
    } catch {
      throw new GenerationError(controller.signal.aborted ? "timeout" : "upstream_body_error");
    }
  } finally {
    clearTimeout(timer);
  }

  // OpenRouter answers 200 once a provider accepts, and reports later failures
  // as an `error` body with no choices.
  const completion = completionSchema.safeParse(body);
  const choice = completion.success ? completion.data.choices?.[0] : undefined;
  if (!completion.success || completion.data.error != null || !choice || choice.finish_reason === "error") {
    throw new GenerationError("upstream_body_error");
  }

  // An empty reply (refusal) and truncation (finish_reason "length", whose cut-off
  // JSON does not parse) are both unusable output rather than upstream failures.
  const content = choice.message.content;
  if (content == null) throw new GenerationError("invalid_output");
  let output: unknown;
  try {
    output = JSON.parse(content);
  } catch {
    throw new GenerationError("invalid_output");
  }
  const raw = rawOutputSchema.safeParse(output);
  if (!raw.success) throw new GenerationError("invalid_output");

  const valid: FlashcardProposalDto[] = [];
  for (const card of raw.data.cards) {
    const parsed = createFlashcardSchema.safeParse(card);
    if (parsed.success) valid.push(parsed.data);
  }
  const proposals = valid.slice(0, MAX_PROPOSALS);
  if (proposals.length === 0) throw new GenerationError("no_valid_cards");

  return {
    proposals,
    meta: {
      dropped: raw.data.cards.length - proposals.length,
      latencyMs: Date.now() - started,
      usage: usageSchema.safeParse(completion.data.usage).data,
    },
  };
}
