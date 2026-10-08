import type { APIContext, APIRoute } from "astro";
import { z } from "zod";
import { apiError } from "@/lib/api-errors";
import { readBody } from "@/lib/read-body";
import { deleteFlashcard, updateFlashcard } from "@/lib/services/flashcards";
import { createClient } from "@/lib/supabase";
import { createFlashcardSchema } from "@/lib/validation/flashcard";

export const prerender = false;

// One card of at most 700 characters, at up to 4 UTF-8 bytes each, plus JSON keys.
const MAX_BODY_BYTES = 8 * 1024;

// z.guid(), not z.uuid(): Postgres accepts any 8-4-4-4-12 hex string as a uuid,
// while z.uuid() also checks the RFC version and variant bits.
const idSchema = z.guid();

// A malformed id cannot name a card, and passed on it would fail in Postgres
// (22P02) and surface as server_error; it gets the same answer as a missing card.
function cardId(context: APIContext): string | null {
  const parsed = idSchema.safeParse(context.params.id);
  return parsed.success ? parsed.data : null;
}

function logFailure(operation: string, error: unknown) {
  // Only code and message reach the Worker log: a PostgrestError's details can
  // quote the failing row, i.e. the user's card text. The client gets the fixed code.
  const { code, message } = error as { code?: string; message?: string };
  // eslint-disable-next-line no-console
  console.error(`${operation} failed`, { code, message });
}

// Replaces the card's front and back. The schema strips every other key, so an
// edit can never write source or user_id.
export const PATCH: APIRoute = async (context) => {
  if (!context.locals.user) {
    return apiError("unauthorized", "Sign in to edit flashcards");
  }

  const id = cardId(context);
  if (!id) {
    return apiError("not_found", "Flashcard not found");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return apiError("server_error", "Supabase is not configured");
  }

  const read = await readBody(context.request, MAX_BODY_BYTES);
  if (read === "too_large") {
    return apiError("validation_failed", "Invalid flashcard", {
      fieldErrors: { _root: ["Request body is too large"] },
    });
  }
  if (read === "unreadable") {
    return apiError("invalid_json", "Request body could not be read");
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return apiError("invalid_json", "Request body must be valid JSON");
  }

  const parsed = createFlashcardSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("validation_failed", "Invalid flashcard", {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    });
  }

  try {
    // parsed.data, not body: it carries the trimmed values the schema measured
    const card = await updateFlashcard(supabase, id, parsed.data);
    if (!card) {
      return apiError("not_found", "Flashcard not found");
    }
    return Response.json(card);
  } catch (error) {
    logFailure("updateFlashcard", error);
    return apiError("server_error", "Could not save the flashcard");
  }
};

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return apiError("unauthorized", "Sign in to delete flashcards");
  }

  const id = cardId(context);
  if (!id) {
    return apiError("not_found", "Flashcard not found");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return apiError("server_error", "Supabase is not configured");
  }

  try {
    if (!(await deleteFlashcard(supabase, id))) {
      return apiError("not_found", "Flashcard not found");
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    logFailure("deleteFlashcard", error);
    return apiError("server_error", "Could not delete the flashcard");
  }
};
