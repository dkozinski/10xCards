import type { Tables, TablesInsert, TablesUpdate } from "@/db/database.types";

// DTOs are aliases over generated types, so they cannot drift from the schema.
// Fields stay snake_case, exactly as Postgres returns them.

export type FlashcardDto = Tables<"flashcards">;

// user_id is omitted on purpose: the column defaults to auth.uid()
export type CreateFlashcardCommand = Pick<TablesInsert<"flashcards">, "front" | "back">;

export type UpdateFlashcardCommand = Pick<TablesUpdate<"flashcards">, "front" | "back">;

// An unsaved AI draft, not a DB row. Already valid under createFlashcardSchema,
// so S-03 can save it as a CreateFlashcardCommand unchanged.
export type FlashcardProposalDto = CreateFlashcardCommand;

export interface GenerateProposalsCommand {
  text: string;
}

export interface ProposalsResponseDto {
  proposals: FlashcardProposalDto[];
}
