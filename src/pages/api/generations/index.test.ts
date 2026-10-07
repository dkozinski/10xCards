import { inspect } from "node:util";
import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createClient } from "@/lib/supabase";
import { POST } from "./index";

// The real module imports astro:env/server, which only exists inside Astro.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const user = { id: "00000000-0000-0000-0000-00000000000a" };
const ID = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
// A marker that must never appear in any log argument.
const SECRET = "SEKRET-KARTY";

function stubClient(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }));
  vi.mocked(createClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createClient>);
  return rpc;
}

function call(body: string, locals: { user: unknown } = { user }) {
  const request = new Request("http://localhost/api/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return POST({ request, locals, cookies: {} } as unknown as APIContext);
}

function payload(cards: unknown[], generated_count = 3) {
  return JSON.stringify({ generation_id: ID, generated_count, cards });
}

async function errorOf(response: Response) {
  const body = (await response.json()) as {
    error: { code: string; details?: { fieldErrors: Record<string, string[]> } };
  };
  return body.error;
}

describe("POST /api/generations", () => {
  let logError: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects a request without a session before creating a client", async () => {
    stubClient({ data: 0 });
    const response = await call("{not json", { user: null });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("unauthorized");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("reports a missing Supabase configuration before reading the body", async () => {
    vi.mocked(createClient).mockReturnValue(null);
    const response = await call("{not json");
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
  });

  it("rejects an oversized body as validation_failed on _root", async () => {
    const rpc = stubClient({ data: 0 });
    const response = await call(payload([{ front: "x".repeat(70_000), back: "A", source: "ai" }]));
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("validation_failed");
    expect(error.details).toEqual({ fieldErrors: { _root: ["Request body is too large"] } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const rpc = stubClient({ data: 0 });
    const response = await call("{not json");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("invalid_json");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("points a per-card error at the card's dotted path", async () => {
    const rpc = stubClient({ data: 0 });
    const response = await call(payload([{ front: "   ", back: "A", source: "ai" }]));
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("validation_failed");
    expect(error.details).toEqual({ fieldErrors: { "cards.0.front": ["Front is required"] } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the parsed, trimmed values to the RPC and returns the count", async () => {
    const rpc = stubClient({ data: 1 });
    const response = await call(payload([{ front: "  Q ", back: "\nA\t", source: "ai_edited", user_id: "x" }]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved_count: 1 });
    expect(rpc).toHaveBeenCalledWith("save_generation", {
      p_generation_id: ID,
      p_generated_count: 3,
      p_cards: [{ front: "Q", back: "A", source: "ai_edited" }],
    });
  });

  it("saves an all-rejected generation with zero cards", async () => {
    stubClient({ data: 0 });
    const response = await call(payload([], 4));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved_count: 0 });
  });

  it("hides an RPC failure behind server_error and logs no card text", async () => {
    stubClient({
      error: {
        code: "23514",
        message: 'new row for relation "flashcards" violates check constraint',
        details: `Failing row contains (${SECRET}, ...)`,
      },
    });
    const response = await call(payload([{ front: SECRET, back: "A", source: "ai" }]));
    expect(response.status).toBe(500);
    const error = await errorOf(response);
    expect(error.code).toBe("server_error");
    expect(JSON.stringify(error)).not.toContain("check constraint");
    expect(logError).toHaveBeenCalledWith("saveGeneration failed", {
      code: "23514",
      message: 'new row for relation "flashcards" violates check constraint',
    });
    expect(inspect(logError.mock.calls, { depth: null })).not.toContain(SECRET);
  });
});
