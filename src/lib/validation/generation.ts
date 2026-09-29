import { z } from "zod";

// No server imports here: the generate island uses this schema in the browser too.

export const SOURCE_TEXT_MIN = 500;
export const SOURCE_TEXT_MAX = 20_000;
export const MAX_PROPOSALS = 20;

// Same storability rule as card text: an unpaired surrogate or NUL would come
// back in the model output and fail the per-card check anyway.
const isProcessable = (s: string) => !s.includes("\0") && s.isWellFormed();

export const generateProposalsSchema = z.object({
  text: z
    .string()
    .trim()
    .min(SOURCE_TEXT_MIN, `Text must be at least ${SOURCE_TEXT_MIN} characters`)
    .max(SOURCE_TEXT_MAX, `Text must be at most ${SOURCE_TEXT_MAX} characters`)
    .refine(isProcessable, "Text contains characters that cannot be processed"),
});

// The shape the model is asked for, sent as JSON Schema in response_format.
// Deliberately free of refinements (JSON Schema cannot express them); every card
// is re-checked with createFlashcardSchema after parsing. .max() becomes maxItems.
export const modelOutputSchema = z.object({
  cards: z.array(z.object({ front: z.string(), back: z.string() })).max(MAX_PROPOSALS),
});
