import { inspect } from "node:util";
import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createClient } from "@/lib/supabase";
import { DELETE, PATCH } from "./[id]";

// The real module imports astro:env/server, which only exists inside Astro.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const user = { id: "00000000-0000-0000-0000-00000000000a" };
const id = "11111111-1111-1111-1111-111111111111";
const card = {
  id,
  user_id: user.id,
  front: "Q",
  back: "A",
  source: "ai",
  created_at: "2026-09-28T12:00:00Z",
};

interface Result {
  data?: unknown;
  error?: unknown;
}

// from().update(payload).eq().select().maybeSingle() and from().delete().eq().select()
function stubClient(result: Result) {
  const resolved = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  // update awaits .maybeSingle(); delete awaits the .select() builder itself
  const selected = {
    maybeSingle: resolved,
    then: (onFulfilled: (r: unknown) => unknown) => resolved().then(onFulfilled),
  };
  const eq = vi.fn(() => ({ select: () => selected }));
  const update = vi.fn(() => ({ eq }));
  const del = vi.fn(() => ({ eq }));
  vi.mocked(createClient).mockReturnValue({ from: () => ({ update, delete: del }) } as unknown as ReturnType<
    typeof createClient
  >);
  return { update, del, eq };
}

function patch(body: string, opts: { id?: string; user?: unknown } = {}) {
  const request = new Request(`http://localhost/api/flashcards/${opts.id ?? id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const locals = { user: "user" in opts ? opts.user : user };
  return PATCH({ request, locals, params: { id: opts.id ?? id }, cookies: {} } as unknown as APIContext);
}

function remove(opts: { id?: string; user?: unknown } = {}) {
  const request = new Request(`http://localhost/api/flashcards/${opts.id ?? id}`, { method: "DELETE" });
  const locals = { user: "user" in opts ? opts.user : user };
  return DELETE({ request, locals, params: { id: opts.id ?? id }, cookies: {} } as unknown as APIContext);
}

async function errorOf(response: Response) {
  const body = (await response.json()) as { error: { code: string; details?: unknown } };
  return body.error;
}

const valid = JSON.stringify({ front: "Q", back: "A" });

describe("PATCH /api/flashcards/:id", () => {
  let logError: MockInstance;
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects a request without a session before touching Supabase", async () => {
    stubClient({ data: card });
    const response = await patch("{not json", { user: null });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("unauthorized");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("answers not_found for a malformed id without querying", async () => {
    const { update } = stubClient({ data: card });
    const response = await patch(valid, { id: "not-a-uuid" });
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("not_found");
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a missing Supabase configuration before reading the body", async () => {
    vi.mocked(createClient).mockReturnValue(null);
    const response = await patch("{not json");
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
  });

  it("rejects a body over the size limit", async () => {
    const { update } = stubClient({ data: card });
    const response = await patch(JSON.stringify({ front: "Q", back: "x".repeat(9000) }));
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({
      code: "validation_failed",
      message: "Invalid flashcard",
      details: { fieldErrors: { _root: ["Request body is too large"] } },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const { update } = stubClient({ data: card });
    const response = await patch("{not json");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("invalid_json");
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an invalid card with per-field errors", async () => {
    const { update } = stubClient({ data: card });
    const response = await patch(JSON.stringify({ front: "   ", back: "x".repeat(501) }));
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("validation_failed");
    expect(error.details).toEqual({
      fieldErrors: { front: ["Front is required"], back: ["Back must be at most 500 characters"] },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("updates only the trimmed front and back of the addressed card", async () => {
    const { update, eq } = stubClient({ data: card });
    const response = await patch(
      JSON.stringify({ front: "  Q ", back: "\nA\t", source: "manual", user_id: "someone-else", id: "other" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(card);
    expect(update).toHaveBeenCalledWith({ front: "Q", back: "A" });
    expect(eq).toHaveBeenCalledWith("id", id);
  });

  it("answers not_found when no row was updated (missing or another user's card)", async () => {
    stubClient({ data: null });
    const response = await patch(valid);
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("not_found");
  });

  it("hides a database failure behind server_error, also in the log", async () => {
    stubClient({ error: { code: "23514", message: "check failed", details: "Failing row contains (SECRET)" } });
    const response = await patch(valid);
    expect(response.status).toBe(500);
    const error = await errorOf(response);
    expect(error.code).toBe("server_error");
    expect(JSON.stringify(error)).not.toContain("check failed");
    expect(inspect(logError.mock.calls, { depth: null })).not.toContain("SECRET");
  });
});

describe("DELETE /api/flashcards/:id", () => {
  let logError: MockInstance;
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects a request without a session before touching Supabase", async () => {
    stubClient({ data: [{ id }] });
    const response = await remove({ user: null });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("unauthorized");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("answers not_found for a malformed id without querying", async () => {
    const { del } = stubClient({ data: [{ id }] });
    const response = await remove({ id: "not-a-uuid" });
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("not_found");
    expect(del).not.toHaveBeenCalled();
  });

  it("reports a missing Supabase configuration", async () => {
    vi.mocked(createClient).mockReturnValue(null);
    const response = await remove();
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
  });

  it("deletes the addressed card and answers 204 with no body", async () => {
    const { del, eq } = stubClient({ data: [{ id }] });
    const response = await remove();
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", id);
  });

  it("answers not_found when no row was deleted", async () => {
    stubClient({ data: [] });
    const response = await remove();
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("not_found");
  });

  it("hides a database failure behind server_error, also in the log", async () => {
    stubClient({ error: { code: "42501", message: "permission denied", details: "SECRET" } });
    const response = await remove();
    expect(response.status).toBe(500);
    const error = await errorOf(response);
    expect(error.code).toBe("server_error");
    expect(JSON.stringify(error)).not.toContain("permission denied");
    expect(inspect(logError.mock.calls, { depth: null })).not.toContain("SECRET");
  });
});
