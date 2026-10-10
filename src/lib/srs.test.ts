import { describe, expect, it } from "vitest";
import { parseSrsState, scheduleReview, type SrsCardState } from "./srs";

const now = new Date("2026-10-10T12:00:00Z");
const minutesAfterNow = (iso: string) => (new Date(iso).getTime() - now.getTime()) / 60_000;

// What the column defaults give every card: createEmptyCard()
const newCard: SrsCardState = {
  due: "2026-10-09T08:00:00Z",
  stability: 0,
  difficulty: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  state: "new",
  last_review: null,
};

const reviewCard: SrsCardState = {
  due: "2026-10-10T12:00:00Z",
  stability: 10,
  difficulty: 5,
  scheduled_days: 10,
  learning_steps: 0,
  reps: 5,
  lapses: 1,
  state: "review",
  last_review: "2026-09-30T12:00:00Z",
};

describe("scheduleReview", () => {
  it("New + Again: learning, back in 1 minute", () => {
    const { next } = scheduleReview(newCard, 1, now);
    expect(next.state).toBe("learning");
    expect(minutesAfterNow(next.due)).toBe(1);
    expect(next.reps).toBe(1);
  });

  it("New + Hard: learning, back in 6 minutes", () => {
    const { next } = scheduleReview(newCard, 2, now);
    expect(next.state).toBe("learning");
    expect(minutesAfterNow(next.due)).toBe(6);
  });

  it("New + Good: learning, back in 10 minutes, on the second step", () => {
    const { next } = scheduleReview(newCard, 3, now);
    expect(next.state).toBe("learning");
    expect(minutesAfterNow(next.due)).toBe(10);
    expect(next.learning_steps).toBe(1);
  });

  it("New + Easy: straight to review, at least a day away", () => {
    const { next } = scheduleReview(newCard, 4, now);
    expect(next.state).toBe("review");
    expect(minutesAfterNow(next.due)).toBeGreaterThanOrEqual(24 * 60);
    expect(next.scheduled_days).toBeGreaterThanOrEqual(1);
  });

  it("Review + Again: relearning in 10 minutes, one more lapse", () => {
    const { next } = scheduleReview(reviewCard, 1, now);
    expect(next.state).toBe("relearning");
    expect(minutesAfterNow(next.due)).toBe(10);
    expect(next.lapses).toBe(2);
    expect(next.reps).toBe(6);
  });

  it("Review + Good: stays in review, further out than before", () => {
    const { next } = scheduleReview(reviewCard, 3, now);
    expect(next.state).toBe("review");
    expect(next.scheduled_days).toBeGreaterThan(reviewCard.scheduled_days);
    expect(next.lapses).toBe(1);
  });

  it("records the review time as last_review", () => {
    expect(scheduleReview(newCard, 3, now).next.last_review).toBe(now.toISOString());
  });

  it("logs the card as it was before the grade, with ts-fsrs's due (the previous review)", () => {
    const { log } = scheduleReview(reviewCard, 1, now);
    expect(log).toEqual({
      state: "review",
      due: "2026-09-30T12:00:00.000Z",
      stability: 10,
      difficulty: 5,
      scheduled_days: 10,
      learning_steps: 0,
    });
  });

  it("logs the old due for a card never reviewed before", () => {
    expect(scheduleReview(newCard, 3, now).log.due).toBe("2026-10-09T08:00:00.000Z");
  });

  it("returns exactly the nine stored columns, never the deprecated elapsed_days", () => {
    const { next, log } = scheduleReview(reviewCard, 3, now);
    expect(Object.keys(next).sort()).toEqual(
      [
        "difficulty",
        "due",
        "lapses",
        "last_review",
        "learning_steps",
        "reps",
        "scheduled_days",
        "stability",
        "state",
      ].sort(),
    );
    expect(log).not.toHaveProperty("elapsed_days");
    expect(log).not.toHaveProperty("last_elapsed_days");
  });

  it("is deterministic: the same input gives the same output", () => {
    expect(scheduleReview(reviewCard, 2, now)).toEqual(scheduleReview(reviewCard, 2, now));
  });

  it.each(["new", "learning", "review", "relearning"] as const)("round-trips the %s state", (state) => {
    const card = { ...reviewCard, state };
    expect(scheduleReview(card, 3, now).log.state).toBe(state);
  });
});

describe("parseSrsState", () => {
  it.each(["new", "learning", "review", "relearning"])("accepts %s", (state) => {
    expect(parseSrsState(state)).toBe(state);
  });

  it.each(["mastered", "toString", "constructor", "__proto__"])("rejects %p, a value outside the CHECK", (state) => {
    expect(() => parseSrsState(state)).toThrow(`unknown flashcard state: ${state}`);
  });
});
