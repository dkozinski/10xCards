import type { Tables, TablesInsert, TablesUpdate } from "@/db/database.types";

// DTOs are aliases over generated types, so they cannot drift from the schema.
// Fields stay snake_case, exactly as Postgres returns them.

export type FlashcardDto = Tables<"flashcards">;

// flashcards.source is text + CHECK in the DB, so the generated type is a plain
// string; this union mirrors flashcards_source_check.
export type FlashcardSource = "manual" | "ai" | "ai_edited";

// user_id is omitted on purpose: the column defaults to auth.uid(); source is
// omitted too, so manual cards default to 'manual'
export type CreateFlashcardCommand = Pick<TablesInsert<"flashcards">, "front" | "back">;

// A full replacement of the card's text. source is never part of an edit: it
// records where the card came from, and an edit after save does not change that.
export type UpdateFlashcardCommand = Required<Pick<TablesUpdate<"flashcards">, "front" | "back">>;

// An unsaved AI draft, not a DB row. Already valid under createFlashcardSchema;
// the source ('ai' or 'ai_edited') is decided at save time, after review.
export type FlashcardProposalDto = CreateFlashcardCommand;

export interface GenerateProposalsCommand {
  text: string;
}

export interface ProposalsResponseDto {
  proposals: FlashcardProposalDto[];
}

// Body of POST /api/generations: the kept cards of one reviewed generation.
// generation_id is minted by the client and reused on retry (idempotency key);
// cards may be empty when every proposal was rejected.
export interface SaveGenerationCommand {
  generation_id: string;
  generated_count: number;
  cards: (FlashcardProposalDto & { source: Exclude<FlashcardSource, "manual"> })[];
}

export interface SaveGenerationResponseDto {
  saved_count: number;
}
