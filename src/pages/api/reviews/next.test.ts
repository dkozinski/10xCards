import { inspect } from "node:util";
import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createClient } from "@/lib/supabase";
import { GET } from "./next";

// The real module imports astro:env/server, which only exists inside Astro.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const user = { id: "00000000-0000-0000-0000-00000000000a" };
const now = new Date("2026-10-10T12:00:00Z");
const card = { id: "00000000-0000-0000-0000-0000000000a1", front: "Q", back: "A", state: "learning" };

function stubClient(result: { data?: unknown; error?: unknown } = { data: { card, due_count: 2 } }) {
  const rpc = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }));
  vi.mocked(createClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createClient>);
  return { rpc };
}

function get(query: string, opts: { user?: unknown } = {}) {
  const url = new URL(`http://localhost/api/reviews/next${query}`);
  const request = new Request(url);
  const locals = { user: "user" in opts ? opts.user : user };
  return GET({ request, url, locals, params: {}, cookies: {} } as unknown as APIContext);
}

async function errorOf(response: Response) {
  const body = (await response.json()) as { error: { code: string; details?: { fieldErrors: object } } };
  return body.error;
}

const dayEnd = "2026-10-10T22:00:00.000Z";

describe("GET /api/reviews/next", () => {
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
    const response = await get(`?day_end=${dayEnd}`, { user: null });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("unauthorized");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("answers with the next card and the due count", async () => {
    const { rpc } = stubClient();
    const response = await get(`?day_end=${dayEnd}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ card, due_count: 2 });
    expect(rpc).toHaveBeenCalledWith("next_review_card", {
      p_now: "2026-10-10T12:00:00.000Z",
      p_day_end: dayEnd,
      p_learning_only: false,
    });
  });

  it("reads learning_only=true", async () => {
    const { rpc } = stubClient();
    await get(`?day_end=${dayEnd}&learning_only=true`);
    expect(rpc).toHaveBeenCalledWith("next_review_card", expect.objectContaining({ p_learning_only: true }));
  });

  it("answers an empty queue with card null", async () => {
    stubClient({ data: { card: null, due_count: 0 } });
    const response = await get(`?day_end=${dayEnd}`);
    expect(await response.json()).toEqual({ card: null, due_count: 0 });
  });

  it.each([
    ["a missing day_end", ""],
    ["a day_end equal to now", "?day_end=2026-10-10T12:00:00.000Z"],
    ["a day_end beyond 48 hours", "?day_end=2026-10-12T12:00:01.000Z"],
    ["an invalid learning_only", `?day_end=${dayEnd}&learning_only=1`],
  ])("rejects %s with validation_failed before touching the database", async (_label, query) => {
    const { rpc } = stubClient();
    const response = await get(query);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("validation_failed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers server_error when the lookup fails, logging no card text", async () => {
    stubClient({ error: { code: "57014", message: "canceling statement", details: "row (Q secret)" } });
    const response = await get(`?day_end=${dayEnd}`);
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
    expect(logError).toHaveBeenCalledWith("nextReviewCard failed", {
      code: "57014",
      message: "canceling statement",
    });
    expect(inspect(logError.mock.calls)).not.toContain("secret");
  });

  it("answers server_error when the function returns an unexpected shape", async () => {
    stubClient({ data: { card: null } });
    const response = await get(`?day_end=${dayEnd}`);
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
  });
});
