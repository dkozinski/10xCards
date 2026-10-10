import { inspect } from "node:util";
import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createClient } from "@/lib/supabase";
import { POST } from "./index";

// The real module imports astro:env/server, which only exists inside Astro.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const user = { id: "00000000-0000-0000-0000-00000000000a" };
const now = new Date("2026-10-10T12:00:00Z");
const flashcardId = "00000000-0000-0000-0000-0000000000a1";
const nextCard = { id: "00000000-0000-0000-0000-0000000000a2", front: "Next Q", back: "Next A", state: "new" };

const storedCard = {
  due: "2026-10-09T08:00:00+00:00",
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

// from().select().eq().maybeSingle() reads the card; rpc() answers record_review
// and next_review_card by name
function stubClient({
  card = { data: storedCard },
  record = { data: true },
  next = { data: { card: nextCard, due_count: 4 } },
}: { card?: Result; record?: Result; next?: Result } = {}) {
  const asResponse = (r: Result) => Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
  const rpc = vi.fn((name: string) => asResponse(name === "record_review" ? record : next));
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: () => asResponse(card) }) }) }));
  vi.mocked(createClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof createClient>);
  return { rpc, from };
}

const valid = {
  review_id: "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f",
  flashcard_id: flashcardId,
  rating: 3,
  day_end: "2026-10-10T22:00:00.000Z",
};

function post(body: string, opts: { user?: unknown } = {}) {
  const request = new Request("http://localhost/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const locals = { user: "user" in opts ? opts.user : user };
  return POST({ request, locals, params: {}, cookies: {} } as unknown as APIContext);
}

async function errorOf(response: Response) {
  const body = (await response.json()) as { error: { code: string; details?: { fieldErrors: object } } };
  return body.error;
}

describe("POST /api/reviews", () => {
  let logError: MockInstance;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.mocked(createClient).mockReset();
    logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    logError.mockRestore();
  });

  it("rejects a request without a session before touching Supabase", async () => {
    stubClient();
    const response = await post(JSON.stringify(valid), { user: null });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("unauthorized");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("saves the grade and answers with the next card", async () => {
    const { rpc } = stubClient();
    const response = await post(JSON.stringify(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ card: nextCard, due_count: 4 });

    expect(rpc).toHaveBeenNthCalledWith(1, "record_review", expect.objectContaining({ p_rating: 3 }));
    expect(rpc).toHaveBeenNthCalledWith(2, "next_review_card", {
      p_now: "2026-10-10T12:00:00.000Z",
      p_day_end: "2026-10-10T22:00:00.000Z",
      p_learning_only: false,
    });
  });

  it("answers a replay exactly like the first save", async () => {
    stubClient({ record: { data: false } });
    const response = await post(JSON.stringify(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ card: nextCard, due_count: 4 });
  });

  it("passes learning_only through to the next-card lookup", async () => {
    const { rpc } = stubClient();
    await post(JSON.stringify({ ...valid, learning_only: true }));
    expect(rpc).toHaveBeenNthCalledWith(2, "next_review_card", expect.objectContaining({ p_learning_only: true }));
  });

  it("answers an empty queue with card null", async () => {
    stubClient({ next: { data: { card: null, due_count: 0 } } });
    const response = await post(JSON.stringify(valid));
    expect(await response.json()).toEqual({ card: null, due_count: 0 });
  });

  it("answers not_found for a card that does not exist for the caller, without writing", async () => {
    const { rpc } = stubClient({ card: { data: null } });
    const response = await post(JSON.stringify(valid));
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("not_found");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers not_found when the card is deleted between the read and the write", async () => {
    stubClient({ record: { error: { code: "P0002", message: "flashcard not found" } } });
    const response = await post(JSON.stringify(valid));
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("not_found");
  });

  it.each([
    ["rating 0", { rating: 0 }, "rating"],
    ["rating 5", { rating: 5 }, "rating"],
    ["a day_end that is not a datetime", { day_end: "tomorrow" }, "day_end"],
    ["a malformed review_id", { review_id: "nope" }, "review_id"],
    ["a malformed flashcard_id", { flashcard_id: "nope" }, "flashcard_id"],
  ])("rejects %s with validation_failed before touching the database", async (_label, patch, field) => {
    const { rpc, from } = stubClient();
    const response = await post(JSON.stringify({ ...valid, ...patch }));
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("validation_failed");
    expect(error.details?.fieldErrors).toHaveProperty(field);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["in the past (a session past local midnight)", "2026-10-10T00:00:00.000Z"],
    ["beyond 48 hours", "2026-10-12T12:00:01.000Z"],
  ])(
    "saves the grade even with a day_end %s, then answers validation_failed without a lookup",
    async (_label, day_end) => {
      const { rpc } = stubClient();
      const response = await post(JSON.stringify({ ...valid, day_end }));
      expect(response.status).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe("validation_failed");
      expect(error.details?.fieldErrors).toHaveProperty("day_end");
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("record_review", expect.anything());
    },
  );

  it("a retry with a fresh day_end after a stale one replays and returns the next card", async () => {
    stubClient();
    expect((await post(JSON.stringify({ ...valid, day_end: "2026-10-10T00:00:00.000Z" }))).status).toBe(400);

    const { rpc } = stubClient({ record: { data: false } });
    const response = await post(JSON.stringify(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ card: nextCard, due_count: 4 });
    expect(rpc).toHaveBeenCalledWith("record_review", expect.objectContaining({ p_review_id: valid.review_id }));
  });

  it("answers invalid_json for a body that is not JSON, before touching the database", async () => {
    const { rpc, from } = stubClient();
    const response = await post("{not json");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("invalid_json");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before touching the database", async () => {
    const { rpc, from } = stubClient();
    const response = await post(JSON.stringify({ ...valid, padding: "x".repeat(3000) }));
    expect(response.status).toBe(400);
    expect((await errorOf(response)).details?.fieldErrors).toHaveProperty("_root");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses one clock for the save and the lookup, even when time moves during the save", async () => {
    const { rpc } = stubClient();
    rpc.mockImplementation((name: string) => {
      if (name === "record_review") {
        vi.setSystemTime(new Date(now.getTime() + 60_000));
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: { card: nextCard, due_count: 4 }, error: null });
    });
    expect((await post(JSON.stringify(valid))).status).toBe(200);

    const calls = rpc.mock.calls as unknown as [string, Record<string, unknown>][];
    const saved = calls.find(([name]) => name === "record_review")?.[1];
    const looked = calls.find(([name]) => name === "next_review_card")?.[1];
    expect(saved?.p_reviewed_at).toBe("2026-10-10T12:00:00.000Z");
    expect(looked?.p_now).toBe(saved?.p_reviewed_at);
  });

  it("answers server_error for a review id the database refuses (22023), without a lookup", async () => {
    const { rpc } = stubClient({
      record: { error: { code: "22023", message: "review id belongs to another card" } },
    });
    const response = await post(JSON.stringify(valid));
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("answers server_error when the save fails, logging no card text", async () => {
    stubClient({
      record: { error: { code: "23514", message: "violates check", details: "Failing row contains (Q secret)" } },
    });
    const response = await post(JSON.stringify(valid));
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
    expect(logError).toHaveBeenCalledWith("recordReview failed", { code: "23514", message: "violates check" });
    expect(inspect(logError.mock.calls)).not.toContain("secret");
  });

  it("answers server_error when the next card cannot be loaded after a saved grade", async () => {
    const { rpc } = stubClient({ next: { error: { code: "57014", message: "canceling statement" } } });
    const response = await post(JSON.stringify(valid));
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
    expect(rpc).toHaveBeenCalledWith("record_review", expect.anything());
    expect(logError).toHaveBeenCalledWith("nextReviewCard failed", expect.anything());
  });

  it("answers server_error when Supabase is not configured", async () => {
    vi.mocked(createClient).mockReturnValue(null);
    const response = await post(JSON.stringify(valid));
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
  });
});
