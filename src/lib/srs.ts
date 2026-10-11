import { fsrs, Rating, State, type Grade } from "ts-fsrs";
import type { FlashcardDto, ReviewRating, SrsState } from "@/types";

// The only module that touches ts-fsrs. It translates between the flashcards
// columns and the library's objects, so the rest of the app never sees its
// types. Pure: the result depends only on the card, the grade and the time.

// The nine FSRS columns of a card. elapsed_days is deprecated in ts-fsrs and
// not stored: it is fed as 0 and never returned.
export type SrsCardState = Pick<
  FlashcardDto,
  "due" | "stability" | "difficulty" | "scheduled_days" | "learning_steps" | "reps" | "lapses" | "last_review"
> & { state: SrsState };

// The card before the grade, as ts-fsrs ReviewLog reports it: the row
// review_logs keeps besides the rating and the review time. Kept verbatim, so
// due is ReviewLog.due: the previous review time (the old due only for a card
// never reviewed before), not the due date the card had.
export type SrsReviewSnapshot = Pick<
  SrsCardState,
  "state" | "due" | "stability" | "difficulty" | "scheduled_days" | "learning_steps"
>;

// Library defaults: retention 0.9, fuzz off, learning steps 1m/10m,
// relearning step 10m, so Again/Hard on a new card come back within minutes.
const scheduler = fsrs();

const TO_FSRS: Record<SrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const FROM_FSRS: Record<State, SrsState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const GRADES: Record<ReviewRating, Grade> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

// flashcards.state is text in the generated types; the CHECK guarantees one of
// the four values, so anything else means the schema and the code disagree.
export function parseSrsState(state: string): SrsState {
  // own keys only: `in` would also accept "toString" or "__proto__"
  if (Object.hasOwn(TO_FSRS, state)) return state as SrsState;
  throw new Error(`unknown flashcard state: ${state}`);
}

export function scheduleReview(
  card: SrsCardState,
  rating: ReviewRating,
  now: Date,
): { next: SrsCardState; log: SrsReviewSnapshot } {
  const { card: next, log } = scheduler.next(
    {
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: 0,
      scheduled_days: card.scheduled_days,
      learning_steps: card.learning_steps,
      reps: card.reps,
      lapses: card.lapses,
      state: TO_FSRS[card.state],
      last_review: card.last_review,
    },
    now,
    GRADES[rating],
  );

  return {
    next: {
      due: next.due.toISOString(),
      stability: next.stability,
      difficulty: next.difficulty,
      scheduled_days: next.scheduled_days,
      learning_steps: next.learning_steps,
      reps: next.reps,
      lapses: next.lapses,
      state: FROM_FSRS[next.state],
      last_review: next.last_review ? next.last_review.toISOString() : null,
    },
    log: {
      state: FROM_FSRS[log.state],
      due: log.due.toISOString(),
      stability: log.stability,
      difficulty: log.difficulty,
      scheduled_days: log.scheduled_days,
      learning_steps: log.learning_steps,
    },
  };
}
