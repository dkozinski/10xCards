import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/database.types";
import type { RecordReviewCommand } from "@/types";
import { nextReviewCard, recordReview } from "./reviews";

const now = new Date("2026-10-10T12:00:00Z");
const dayEnd = new Date("2026-10-10T22:00:00Z");

const cmd: RecordReviewCommand = {
  review_id: "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f",
  flashcard_id: "00000000-0000-0000-0000-0000000000a1",
  rating: 3,
};

// the FSRS columns of a card that has never been reviewed (column defaults)
const storedCard = {
  // PostgREST returns timestamptz with microseconds
  due: "2026-10-09T08:00:00.123456+00:00",
  stability: 0,
  difficulty: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  state: "new",
  last_review: null,
};

interface Result {
  data?: unknown;
  error?: unknown;
}

// from().select(columns).eq("id", …).maybeSingle() for the card, rpc() for both functions
function stubClient({ card = { data: storedCard }, rpc = { data: true } }: { card?: Result; rpc?: Result } = {}) {
  const maybeSingle = vi.fn(() => Promise.resolve({ data: card.data ?? null, error: card.error ?? null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpcFn = vi.fn(() => Promise.resolve({ data: rpc.data ?? null, error: rpc.error ?? null }));
  return { client: { from, rpc: rpcFn } as unknown as SupabaseClient<Database>, from, select, eq, rpc: rpcFn };
}

describe("recordReview", () => {
  it("reads the card's FSRS state by id, then stores the scheduled state", async () => {
    const { client, from, select, eq, rpc } = stubClient();
    await expect(recordReview(client, cmd, now)).resolves.toBe("applied");

    expect(from).toHaveBeenCalledWith("flashcards");
    expect(select).toHaveBeenCalledWith(
      "due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review",
    );
    expect(eq).toHaveBeenCalledWith("id", cmd.flashcard_id);
    const [name, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe("record_review");
    expect(args).toMatchObject({
      p_review_id: cmd.review_id,
      p_flashcard_id: cmd.flashcard_id,
      p_rating: 3,
      p_reviewed_at: "2026-10-10T12:00:00.000Z",
      // New + Good: second learning step, back in 10 minutes
      p_next: {
        state: "learning",
        due: "2026-10-10T12:10:00.000Z",
        learning_steps: 1,
        reps: 1,
        last_review: "2026-10-10T12:00:00.000Z",
      },
      // a never-reviewed card logs its old due (ts-fsrs semantics), parsed to milliseconds
      p_log: { state: "new", due: "2026-10-09T08:00:00.123Z", stability: 0, difficulty: 0 },
    });
  });

  it("never sends user_id or card text to the RPC", async () => {
    const { client, rpc } = stubClient();
    await recordReview(client, cmd, now);
    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(Object.keys(args).sort()).toEqual(
      ["p_flashcard_id", "p_log", "p_next", "p_rating", "p_review_id", "p_reviewed_at"].sort(),
    );
    expect(JSON.stringify(args)).not.toContain("user_id");
  });

  it("reports a replay when the review id was already applied", async () => {
    const { client } = stubClient({ rpc: { data: false } });
    await expect(recordReview(client, cmd, now)).resolves.toBe("replay");
  });

  it("returns null without writing when the card is not visible", async () => {
    const { client, rpc } = stubClient({ card: { data: null } });
    await expect(recordReview(client, cmd, now)).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns null when the card disappears between the read and the write (P0002)", async () => {
    const { client } = stubClient({ rpc: { error: { code: "P0002", message: "flashcard not found" } } });
    await expect(recordReview(client, cmd, now)).resolves.toBeNull();
  });

  it.each(["22023", "23514", "42501"])("throws any other RPC error (%s) unchanged", async (code) => {
    const error = { code, message: "boom" };
    const { client } = stubClient({ rpc: { error } });
    await expect(recordReview(client, cmd, now)).rejects.toBe(error);
  });

  it("throws the read error unchanged", async () => {
    const error = { code: "57014", message: "canceling statement" };
    const { client, rpc } = stubClient({ card: { error } });
    await expect(recordReview(client, cmd, now)).rejects.toBe(error);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats a non-boolean RPC result as an error", async () => {
    const { client } = stubClient({ rpc: { data: null } });
    await expect(recordReview(client, cmd, now)).rejects.toThrow("record_review returned no result");
  });

  it("refuses a stored state outside the CHECK instead of guessing", async () => {
    const { client, rpc } = stubClient({ card: { data: { ...storedCard, state: "mastered" } } });
    await expect(recordReview(client, cmd, now)).rejects.toThrow("unknown flashcard state");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("nextReviewCard", () => {
  const card = { id: cmd.flashcard_id, front: "Q", back: "A", state: "new" };

  it("calls next_review_card with ISO times and the flag", async () => {
    const { client, rpc } = stubClient({ rpc: { data: { card, due_count: 3 } } });
    await expect(nextReviewCard(client, { now, dayEnd, learningOnly: true })).resolves.toEqual({
      card,
      due_count: 3,
    });
    expect(rpc).toHaveBeenCalledWith("next_review_card", {
      p_now: "2026-10-10T12:00:00.000Z",
      p_day_end: "2026-10-10T22:00:00.000Z",
      p_learning_only: true,
    });
  });

  it("passes an empty queue through", async () => {
    const { client } = stubClient({ rpc: { data: { card: null, due_count: 0 } } });
    await expect(nextReviewCard(client, { now, dayEnd, learningOnly: false })).resolves.toEqual({
      card: null,
      due_count: 0,
    });
  });

  it("drops fields the function might add, keeping the DTO shape", async () => {
    const { client } = stubClient({ rpc: { data: { card: { ...card, user_id: "x" }, due_count: 1, extra: 1 } } });
    const result = await nextReviewCard(client, { now, dayEnd, learningOnly: false });
    expect(result).toEqual({ card, due_count: 1 });
  });

  it.each([
    ["no data", null],
    ["a missing due_count", { card: null }],
    ["an unknown state", { card: { ...card, state: "mastered" }, due_count: 1 }],
  ])("treats %s as an error", async (_label, data) => {
    const { client } = stubClient({ rpc: { data } });
    await expect(nextReviewCard(client, { now, dayEnd, learningOnly: false })).rejects.toThrow(
      "next_review_card returned an unexpected shape",
    );
  });

  it("throws the RPC error unchanged", async () => {
    const error = { code: "22023", message: "p_day_end must be after p_now" };
    const { client } = stubClient({ rpc: { error } });
    await expect(nextReviewCard(client, { now, dayEnd, learningOnly: false })).rejects.toBe(error);
  });
});
