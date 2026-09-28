import { z } from "zod";

// Stricter than the CHECK constraints on public.flashcards, never looser: any
// value this schema accepts, the database accepts. The reverse does not hold
// (JS trim() also strips tabs/newlines, and .max() counts an emoji as two), so
// routes must insert the parsed output, never the raw body.
// No server imports here: the form island uses this schema in the browser too.

export const FRONT_MAX = 200;
export const BACK_MAX = 500;

// Whitespace and invisible format characters (zero-width space, BOM) are not content.
const hasVisibleChar = (s: string) => /[^\s\p{Cf}]/u.test(s);

// Postgres text cannot hold NUL, and PostgREST rejects unpaired surrogates.
const isStorable = (s: string) => !s.includes("\0") && s.isWellFormed();

function cardText(label: string, max: number) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .refine(hasVisibleChar, `${label} is required`)
    .refine(isStorable, `${label} contains characters that cannot be saved`);
}

export const createFlashcardSchema = z.object({
  front: cardText("Front", FRONT_MAX),
  back: cardText("Back", BACK_MAX),
});
