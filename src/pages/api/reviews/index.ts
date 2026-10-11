import type { APIRoute } from "astro";
import { apiError } from "@/lib/api-errors";
import { readBody } from "@/lib/read-body";
import { nextReviewCard, recordReview } from "@/lib/services/reviews";
import { createClient } from "@/lib/supabase";
import { fieldErrorsFromIssues } from "@/lib/validation/field-errors";
import { DAY_END_MESSAGE, dayEndInWindow, recordReviewSchema } from "@/lib/validation/review";
import type { NextReviewResponseDto } from "@/types";

export const prerender = false;

// Two uuids, a digit, an ISO datetime and a boolean, plus JSON keys.
const MAX_BODY_BYTES = 2 * 1024;

function logFailure(operation: string, error: unknown) {
  // Only code and message reach the Worker log: a PostgrestError's details can
  // quote the failing row, i.e. the user's card text. The client gets the fixed code.
  const { code, message } = error as { code?: string; message?: string };
  // eslint-disable-next-line no-console
  console.error(`${operation} failed`, { code, message });
}

// Saves one grade, then answers with the next card. A retry with the same
// review_id is a replay: nothing is written and the next card is looked up
// again, so the client may retry any failure, including one after the save.
export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return apiError("unauthorized", "Sign in to review flashcards");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return apiError("server_error", "Supabase is not configured");
  }

  const read = await readBody(context.request, MAX_BODY_BYTES);
  if (read === "too_large") {
    return apiError("validation_failed", "Invalid review", {
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

  const parsed = recordReviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("validation_failed", "Invalid review", { fieldErrors: fieldErrorsFromIssues(parsed.error) });
  }
  const { review_id, flashcard_id, rating, day_end, learning_only } = parsed.data;

  // one clock for the schedule, the day_end bound and the next-card lookup
  const now = new Date();

  try {
    if (!(await recordReview(supabase, { review_id, flashcard_id, rating }, now))) {
      return apiError("not_found", "Flashcard not found");
    }
  } catch (error) {
    logFailure("recordReview", error);
    return apiError("server_error", "Could not save the grade");
  }

  // Checked after the save on purpose: day_end only feeds the lookup below, and a
  // stale one (a session past local midnight, a slow device clock) must not cost
  // the grade. The client retries with a fresh day_end and the same review_id,
  // which replays (nothing written twice) and returns the next card.
  if (!dayEndInWindow(day_end, now)) {
    return apiError("validation_failed", "Invalid review", { fieldErrors: { day_end: [DAY_END_MESSAGE] } });
  }

  try {
    const response: NextReviewResponseDto = await nextReviewCard(supabase, {
      now,
      dayEnd: day_end,
      learningOnly: learning_only,
    });
    return Response.json(response);
  } catch (error) {
    // the grade is saved; a retry with the same review_id replays and looks again
    logFailure("nextReviewCard", error);
    return apiError("server_error", "Could not load the next card");
  }
};
