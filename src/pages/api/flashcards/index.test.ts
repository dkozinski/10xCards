import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase";
import { POST } from "./index";

// The real module imports astro:env/server, which only exists inside Astro.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const user = { id: "00000000-0000-0000-0000-00000000000a" };
const card = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: user.id,
  front: "Q",
  back: "A",
  created_at: "2026-09-28T12:00:00Z",
};

function stubClient(result: { data?: unknown; error?: unknown }) {
  const insert = vi.fn(() => ({
    select: () => ({
      single: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
    }),
  }));
  vi.mocked(createClient).mockReturnValue({ from: () => ({ insert }) } as unknown as ReturnType<typeof createClient>);
  return insert;
}

function call(body: string, locals: { user: unknown } = { user }) {
  const request = new Request("http://localhost/api/flashcards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return POST({ request, locals, cookies: {} } as unknown as APIContext);
}

async function errorCode(response: Response) {
  const body = (await response.json()) as { error: { code: string; details?: unknown } };
  return body.error;
}

describe("POST /api/flashcards", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects a request without a session", async () => {
    stubClient({ data: card });
    const response = await call("{not json", { user: null });
    expect(response.status).toBe(401);
    expect((await errorCode(response)).code).toBe("unauthorized");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("reports a missing Supabase configuration before reading the body", async () => {
    vi.mocked(createClient).mockReturnValue(null);
    const response = await call("{not json");
    expect(response.status).toBe(500);
    expect((await errorCode(response)).code).toBe("server_error");
  });

  it("rejects a body that is not JSON", async () => {
    const insert = stubClient({ data: card });
    const response = await call("{not json");
    expect(response.status).toBe(400);
    expect((await errorCode(response)).code).toBe("invalid_json");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an invalid card with per-field errors", async () => {
    const insert = stubClient({ data: card });
    const response = await call(JSON.stringify({ front: "   ", back: "x".repeat(501) }));
    expect(response.status).toBe(400);
    const error = await errorCode(response);
    expect(error.code).toBe("validation_failed");
    expect(error.details).toEqual({
      fieldErrors: { front: ["Front is required"], back: ["Back must be at most 500 characters"] },
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates the card from trimmed values without a user_id", async () => {
    const insert = stubClient({ data: card });
    const response = await call(JSON.stringify({ front: "  Q ", back: "\nA\t", user_id: "someone-else" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(card);
    expect(insert).toHaveBeenCalledWith({ front: "Q", back: "A" });
  });

  it("hides a database failure behind server_error", async () => {
    stubClient({ error: new Error("permission denied for table flashcards") });
    const response = await call(JSON.stringify({ front: "Q", back: "A" }));
    expect(response.status).toBe(500);
    const error = await errorCode(response);
    expect(error.code).toBe("server_error");
    expect(JSON.stringify(error)).not.toContain("permission denied");
  });
});
