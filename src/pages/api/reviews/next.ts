import type { APIRoute } from "astro";
import { apiError } from "@/lib/api-errors";
import { nextReviewCard } from "@/lib/services/reviews";
import { createClient } from "@/lib/supabase";
import { fieldErrorsFromIssues } from "@/lib/validation/field-errors";
import { nextReviewQuerySchema } from "@/lib/validation/review";
import type { NextReviewResponseDto } from "@/types";

export const prerender = false;

// The first card of a review session (and the next one after a skipped card).
// Every later card comes back with the grade, from POST /api/reviews. The
// middleware marks every response private, no-store, so no cache keeps a card.
export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return apiError("unauthorized", "Sign in to review flashcards");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return apiError("server_error", "Supabase is not configured");
  }

  const now = new Date();
  const parsed = nextReviewQuerySchema(now).safeParse(Object.fromEntries(context.url.searchParams));
  if (!parsed.success) {
    return apiError("validation_failed", "Invalid review query", { fieldErrors: fieldErrorsFromIssues(parsed.error) });
  }

  try {
    const response: NextReviewResponseDto = await nextReviewCard(supabase, {
      now,
      dayEnd: parsed.data.day_end,
      learningOnly: parsed.data.learning_only,
    });
    return Response.json(response);
  } catch (error) {
    // Only code and message reach the Worker log: a PostgrestError's details can
    // quote the failing row, i.e. the user's card text. The client gets the fixed code.
    const { code, message } = error as { code?: string; message?: string };
    // eslint-disable-next-line no-console
    console.error("nextReviewCard failed", { code, message });
    return apiError("server_error", "Could not load the next card");
  }
};
