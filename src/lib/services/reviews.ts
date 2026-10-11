import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/db/database.types";
import { parseSrsState, scheduleReview } from "@/lib/srs";
import type { NextReviewResponseDto, RecordReviewCommand } from "@/types";

// The only module that calls public.record_review and public.next_review_card.
// It takes the request-scoped client, so both run as the caller and RLS keeps
// every read and write to the caller's own cards; it never sends user_id.

type Client = SupabaseClient<Database>;

// record_review raises this when the card is missing or another user's (RLS
// makes them indistinguishable). Every other SQLSTATE is our bug: the Worker
// builds all the arguments itself.
const CARD_NOT_FOUND = "P0002";

const SRS_COLUMNS = "due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review";

// next_review_card returns jsonb, typed only as Json; check it before the
// route hands it to the client.
const nextReviewSchema = z.object({
  card: z
    .object({
      id: z.string(),
      front: z.string(),
      back: z.string(),
      state: z.enum(["new", "learning", "review", "relearning"]),
    })
    .nullable(),
  due_count: z.int().min(0),
});

export async function nextReviewCard(
  supabase: Client,
  { now, dayEnd, learningOnly }: { now: Date; dayEnd: Date; learningOnly: boolean },
): Promise<NextReviewResponseDto> {
  const { data, error } = await supabase.rpc("next_review_card", {
    p_now: now.toISOString(),
    p_day_end: dayEnd.toISOString(),
    p_learning_only: learningOnly,
  });
  if (error) throw error;

  const parsed = nextReviewSchema.safeParse(data);
  if (!parsed.success) throw new Error("next_review_card returned an unexpected shape");
  return parsed.data;
}

// Grades one card: reads its current FSRS state, schedules the next review and
// stores both atomically. Returns null when the card does not exist for the
// caller, "replay" when review_id was already applied (nothing written).
// Two tabs grading the same card: last write wins (both grades are logged).
export async function recordReview(
  supabase: Client,
  cmd: RecordReviewCommand,
  now: Date,
): Promise<"applied" | "replay" | null> {
  const { data: card, error } = await supabase
    .from("flashcards")
    .select(SRS_COLUMNS)
    .eq("id", cmd.flashcard_id)
    .maybeSingle();
  if (error) throw error;
  if (!card) return null;

  const { next, log } = scheduleReview({ ...card, state: parseSrsState(card.state) }, cmd.rating, now);

  const { data: applied, error: rpcError } = await supabase.rpc("record_review", {
    p_review_id: cmd.review_id,
    p_flashcard_id: cmd.flashcard_id,
    p_rating: cmd.rating,
    p_reviewed_at: now.toISOString(),
    p_next: next,
    p_log: log,
  });
  if (rpcError) {
    // the card was deleted between the read and the write
    if (rpcError.code === CARD_NOT_FOUND) return null;
    throw rpcError;
  }
  // a missing result would let the client advance past a grade that is not confirmed
  if (typeof applied !== "boolean") throw new Error("record_review returned no result");
  return applied ? "applied" : "replay";
}
