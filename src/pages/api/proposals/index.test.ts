import { inspect } from "node:util";
import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { GenerationError, generateProposals, type GenerationErrorKind } from "@/lib/services/generation";
import { SOURCE_TEXT_MAX, SOURCE_TEXT_MIN } from "@/lib/validation/generation";
import { POST } from "./index";

// astro:env/server only exists inside Astro. The factory must export every name
// the route imports; the getter lets a test simulate a missing key.
const env = vi.hoisted((): { key: string | undefined } => ({ key: "sk-or-test" }));
vi.mock("astro:env/server", () => ({
  get OPENROUTER_API_KEY() {
    return env.key;
  },
}));

// Keep the real GenerationError: the route maps it with instanceof.
vi.mock("@/lib/services/generation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/generation")>()),
  generateProposals: vi.fn(),
}));

const user = { id: "00000000-0000-0000-0000-00000000000a" };
// A marker that must never appear in any log argument.
const TEXT = `SEKRET-ZRODLA ${"Fotosynteza zachodzi w chloroplastach. ".repeat(20)}`;

function call(body: string, locals: { user: unknown } = { user }, headers: Record<string, string> = {}) {
  const request = new Request("http://localhost/api/proposals", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  return POST({ request, locals, cookies: {} } as unknown as APIContext);
}

// A streamed body: the Request carries no Content-Length, so only byte counting can stop it.
function callStreamed(body: ReadableStream<Uint8Array>) {
  const request = new Request("http://localhost/api/proposals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
  expect(request.headers.get("Content-Length")).toBeNull();
  return POST({ request, locals: { user }, cookies: {} } as unknown as APIContext);
}

async function errorOf(response: Response) {
  const body = (await response.json()) as {
    error: { code: string; details?: { fieldErrors: Record<string, string[]> } };
  };
  return body.error;
}

describe("POST /api/proposals", () => {
  let logError: MockInstance<(...args: unknown[]) => void>;
  let logInfo: MockInstance<(...args: unknown[]) => void>;

  // inspect, not JSON.stringify: it renders an Error's message and stack, which
  // JSON.stringify drops (they are not enumerable), plus nested objects.
  function loggedText() {
    return [...logError.mock.calls, ...logInfo.mock.calls]
      .flat()
      .map((arg) => inspect(arg, { depth: 10 }))
      .join("\n");
  }

  beforeEach(() => {
    env.key = "sk-or-test";
    vi.mocked(generateProposals).mockReset();
    logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("rejects a request without a session before reading the body", async () => {
    const response = await call("{not json", { user: null });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("unauthorized");
    expect(generateProposals).not.toHaveBeenCalled();
  });

  it("reports a missing OpenRouter key before reading the body", async () => {
    env.key = undefined;
    const response = await call("{not json");
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
    expect(generateProposals).not.toHaveBeenCalled();
  });

  it("checks the session before the key", async () => {
    env.key = undefined;
    const response = await call("{}", { user: null });
    expect(response.status).toBe(401);
  });

  // Invalid JSON on purpose: only the size check can turn these into
  // validation_failed, so the test fails if that check is removed or reordered.
  const OVERSIZE = "{" + "x".repeat(200_000);

  it("rejects a streamed oversize body without a Content-Length header", async () => {
    const response = await callStreamed(new Blob([OVERSIZE]).stream());
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("validation_failed");
    expect(error.details?.fieldErrors.text).toEqual(["Request body is too large"]);
    expect(generateProposals).not.toHaveBeenCalled();
  });

  it("rejects on a declared Content-Length before reading the body", async () => {
    // This body never ends: if the route read it at all, the test would hang and time out.
    const request = new Request("http://localhost/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(10 * 1024 * 1024) },
      body: new ReadableStream(),
      duplex: "half",
    } as RequestInit);
    const response = await POST({ request, locals: { user }, cookies: {} } as unknown as APIContext);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).details?.fieldErrors.text).toEqual(["Request body is too large"]);
  });

  it("maps a body stream that fails mid-upload to invalid_json", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"text":"'));
        controller.error(new Error("Network connection lost"));
      },
    });
    const response = await callStreamed(failing);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("invalid_json");
  });

  it("rejects unparseable JSON", async () => {
    const response = await call("{not json");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("invalid_json");
  });

  it.each([SOURCE_TEXT_MIN - 1, SOURCE_TEXT_MAX + 1])(
    "rejects text of length %i with a text field error",
    async (n) => {
      const response = await call(JSON.stringify({ text: "x".repeat(n) }));
      expect(response.status).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe("validation_failed");
      expect(error.details?.fieldErrors.text).toHaveLength(1);
      expect(generateProposals).not.toHaveBeenCalled();
    },
  );

  it("passes the trimmed text to the service and returns the proposals", async () => {
    const proposals = [{ front: "Q", back: "A" }];
    vi.mocked(generateProposals).mockResolvedValue({ proposals, meta: { dropped: 1, latencyMs: 1234 } });
    const response = await call(JSON.stringify({ text: `  ${TEXT}  \n` }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ proposals });
    expect(generateProposals).toHaveBeenCalledWith("sk-or-test", { text: TEXT.trim() });
    expect(logInfo).toHaveBeenCalledWith(
      "generateProposals ok",
      expect.objectContaining({ count: 1, dropped: 1, latencyMs: 1234 }),
    );
  });

  it.each<[GenerationErrorKind, number | undefined]>([
    ["timeout", undefined],
    ["upstream_http", 429],
    ["upstream_http", undefined],
    ["upstream_body_error", undefined],
    ["invalid_output", undefined],
    ["no_valid_cards", undefined],
  ])("maps %s (status %s) to 502 generation_failed", async (kind, status) => {
    vi.mocked(generateProposals).mockRejectedValue(new GenerationError(kind, status));
    const response = await call(JSON.stringify({ text: TEXT }));
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe("generation_failed");
    expect(logError).toHaveBeenCalledWith("generateProposals failed", expect.objectContaining({ kind, status }));
  });

  it("maps an unexpected error to 500 server_error", async () => {
    vi.mocked(generateProposals).mockRejectedValue(new TypeError(`boom ${TEXT}`));
    const response = await call(JSON.stringify({ text: TEXT }));
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
    expect(logError).toHaveBeenCalledWith("generateProposals crashed", {
      name: "TypeError",
      latencyMs: expect.any(Number) as number,
    });
  });

  it("never logs the source text, on success or on any failure", async () => {
    vi.mocked(generateProposals).mockResolvedValueOnce({
      proposals: [{ front: "Q", back: "A" }],
      meta: { dropped: 0, latencyMs: 1 },
    });
    await call(JSON.stringify({ text: TEXT }));
    vi.mocked(generateProposals).mockRejectedValueOnce(new GenerationError("invalid_output"));
    await call(JSON.stringify({ text: TEXT }));
    vi.mocked(generateProposals).mockRejectedValueOnce(new TypeError(`boom ${TEXT}`));
    await call(JSON.stringify({ text: TEXT }));

    expect(logInfo).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(2);
    expect(loggedText()).not.toContain("SEKRET-ZRODLA");
  });
});
