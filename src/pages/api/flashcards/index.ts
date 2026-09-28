import type { APIRoute } from "astro";
import { z } from "zod";
import { apiError } from "@/lib/api-errors";
import { createFlashcard } from "@/lib/services/flashcards";
import { createClient } from "@/lib/supabase";
import { createFlashcardSchema } from "@/lib/validation/flashcard";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return apiError("unauthorized", "Sign in to create flashcards");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return apiError("server_error", "Supabase is not configured");
  }

  let body: unknown;
  try {
    body = await context.request.json();
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
    const card = await createFlashcard(supabase, parsed.data);
    return Response.json(card, { status: 201 });
  } catch (error) {
    // The database message stays in the Worker log; the client gets the fixed code.
    // eslint-disable-next-line no-console
    console.error("createFlashcard failed", error);
    return apiError("server_error", "Could not save the flashcard");
  }
};
