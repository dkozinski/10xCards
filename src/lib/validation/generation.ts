import { z } from "zod";
import type { FlashcardProposalDto } from "@/types";
import { createFlashcardSchema } from "./flashcard";

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

// Body of POST /api/generations. generated_count is the number of proposals the
// user was shown; cards are the kept ones and may be empty ("Discard all").
// Mirrors the generations CHECKs, so a parsed payload passes them.
export const saveGenerationSchema = z
  .object({
    generation_id: z.uuid(),
    generated_count: z.int().min(1).max(MAX_PROPOSALS),
    cards: z.array(createFlashcardSchema.extend({ source: z.enum(["ai", "ai_edited"]) })).max(MAX_PROPOSALS),
  })
  .refine((cmd) => cmd.cards.length <= cmd.generated_count, {
    message: "Cannot save more cards than were generated",
    path: ["cards"],
  });

// A kept proposal counts as edited only if its trimmed text really changed:
// reverting to the original or touching only whitespace is still 'ai'.
export function proposalSource(
  original: FlashcardProposalDto,
  current: { front: string; back: string },
): "ai" | "ai_edited" {
  const same = current.front.trim() === original.front.trim() && current.back.trim() === original.back.trim();
  return same ? "ai" : "ai_edited";
}
