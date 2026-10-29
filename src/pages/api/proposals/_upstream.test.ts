import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completionBody, errorBody } from "@/lib/services/openrouter.fixtures";
import { POST } from "./index";

// The real route with the real service; only the network edge is stubbed. Each row
// maps a documented OpenRouter answer to what the client receives: the HTTP status
// and error code, or the exact proposals. Service-only concerns (the outgoing request,
// diagnostics, timeouts, no logging) stay in src/lib/services/generation.test.ts.
// 403 is absent on purpose: what a moderation 403 should answer is open (#44).

// astro:env/server only exists inside Astro. The factory must export every name
// the route imports.
vi.mock("astro:env/server", () => ({ OPENROUTER_API_KEY: "sk-or-test" }));

const user = { id: "00000000-0000-0000-0000-00000000000a" };
const TEXT = "Fotosynteza zachodzi w chloroplastach. ".repeat(20);

interface Card {
  front: string;
  back: string;
}

// The model's output format our response_format asks for.
const cardsJson = (cards: unknown[]) => JSON.stringify({ cards });

const VALID: Card[] = [
  { front: "Gdzie zachodzi fotosynteza?", back: "W chloroplastach." },
  { front: "Jaki gaz roślina pobiera do fotosyntezy?", back: "Dwutlenek węgla." },
  { front: "Jaki gaz jest produktem ubocznym fotosyntezy?", back: "Tlen." },
];

// Over the card limits: a front has at most 200 characters, a back at most 500.
const LONG_FRONT = "F".repeat(250);
const LONG_BACK = "B".repeat(501);

// Numbered cards, so expected lists are written as the numbers that survive.
const card = (n: number): Card => ({ front: `Pytanie ${n}`, back: `Odpowiedź ${n}` });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

type Answer = () => Response | Promise<Response>;

// The service calls the global fetch at call time, which vi.stubGlobal replaces.
// `settles` is "rejected" only for a network failure: an answer that throws while
// being built would otherwise pass as one, since both end in 502.
async function generate(answer: Answer, settles: "fulfilled" | "rejected" = "fulfilled") {
  const upstream = vi.fn(() => Promise.resolve().then(answer));
  vi.stubGlobal("fetch", upstream);
  const request = new Request("http://localhost/api/proposals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: TEXT }),
  });
  const response = await POST({ request, locals: { user }, cookies: {} } as unknown as APIContext);
  // A row that never reached OpenRouter proves nothing about its answer.
  expect(upstream).toHaveBeenCalledOnce();
  expect(upstream.mock.settledResults[0]?.type).toBe(settles);
  return response;
}

async function errorCode(response: Response) {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

describe("POST /api/proposals — upstream contract", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each<{ row: string; content: string; finish_reason?: null; proposals: Card[] }>([
    {
      row: "S1: returns the cards of a stop completion, trimmed and in order",
      content: cardsJson([
        { front: "  Gdzie zachodzi fotosynteza? ", back: "W chloroplastach.\n" },
        { front: "Jaki gaz roślina pobiera do fotosyntezy?\t", back: " Dwutlenek węgla." },
        { front: "\nJaki gaz jest produktem ubocznym fotosyntezy?", back: "Tlen.  " },
      ]),
      proposals: VALID,
    },
    {
      row: "S2: returns only the valid cards, in order, when some are invalid",
      content: cardsJson([
        VALID[0],
        { front: LONG_FRONT, back: "Za długi przód." },
        VALID[1],
        { front: LONG_FRONT, back: "Też za długi przód." },
        VALID[2],
      ]),
      proposals: VALID,
    },
    {
      row: "S3: returns the first 20 cards of an over-producing model",
      content: cardsJson(range(1, 25).map(card)),
      proposals: range(1, 20).map(card),
    },
    {
      // Owner decision: refuse known-bad finish reasons, never require a known-good one.
      row: "S4: accepts a completion whose finish_reason is null",
      content: cardsJson(VALID),
      finish_reason: null,
      proposals: VALID,
    },
    {
      // "drop invalid, cap 20": invalid cards do not use up the cap.
      row: "S5: drops invalid cards before capping at 20",
      content: cardsJson(
        range(1, 22).map((n) => {
          if (n === 3) return { front: LONG_FRONT, back: "Odpowiedź 3" };
          if (n === 9) return { front: "Pytanie 9", back: LONG_BACK };
          if (n === 15) return { front: "   ", back: "Odpowiedź 15" };
          return card(n);
        }),
      ),
      proposals: [1, 2, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22].map(card),
    },
  ])("$row", async ({ content, finish_reason, proposals }) => {
    const response = await generate(() => Response.json(completionBody(content, { finish_reason })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ proposals });
  });

  it.each<{ row: string; answer: Answer }>([
    {
      // A failure after a provider accepted: "only an error object and no choices".
      row: "F1: a 200 whose body is only an error object",
      answer: () =>
        Response.json(errorBody(502, "Provider returned error", { error_type: "provider_unavailable" }), {
          status: 200,
        }),
    },
    {
      // No documented body carries both; this guards the documented rule "Check the body
      // for an error field even on a 200": the error wins over a usable choice.
      row: "F1b: a 200 with an error object next to a usable choice",
      answer: () =>
        Response.json({
          ...completionBody(cardsJson(VALID)),
          ...errorBody(502, "Provider returned error", { error_type: "provider_unavailable" }),
        }),
    },
    { row: "F2: a 200 with an empty object", answer: () => Response.json({}) },
    { row: "F3: a 200 with no choices", answer: () => Response.json(completionBody(null, { choices: [] })) },
    {
      // The text-completion choice: `text` in place of `message`.
      row: "F4: a choice without a message",
      answer: () =>
        Response.json(completionBody(null, { choices: [{ finish_reason: "stop", text: cardsJson(VALID) }] })),
    },
    {
      // The documented non-streaming shape of a provider error after partial output.
      row: "F5: finish_reason error with a choice error and parseable content",
      answer: () =>
        Response.json(
          completionBody(cardsJson(VALID), {
            finish_reason: "error",
            error: {
              code: 502,
              message: "Provider disconnected mid-stream",
              metadata: { error_type: "provider_unavailable" },
            },
          }),
        ),
    },
    { row: "F6: null content (no content generated)", answer: () => Response.json(completionBody(null)) },
    { row: "F7: empty content", answer: () => Response.json(completionBody("")) },
    {
      row: "F8: prose instead of JSON",
      answer: () => Response.json(completionBody("Oto fiszki. 1. Gdzie zachodzi fotosynteza? W chloroplastach.")),
    },
    {
      row: "F9: JSON inside a Markdown fence",
      answer: () => Response.json(completionBody("```json\n" + cardsJson(VALID) + "\n```")),
    },
    {
      row: "F10: JSON cut off by finish_reason length",
      answer: () =>
        Response.json(
          completionBody('{"cards":[{"front":"Gdzie zachodzi fotosynteza?","back":"W chloro', {
            finish_reason: "length",
          }),
        ),
    },
    {
      row: "F11: cards under the wrong top-level key",
      answer: () => Response.json(completionBody(JSON.stringify({ flashcards: VALID }))),
    },
    { row: "F12: an empty card list", answer: () => Response.json(completionBody(cardsJson([]))) },
    {
      row: "F13: cards that are all invalid",
      answer: () =>
        Response.json(
          completionBody(
            cardsJson([
              { front: LONG_FRONT, back: "Za długi przód." },
              { front: "   ", back: "Pusty przód." },
              { front: "Pytanie", back: LONG_BACK },
            ]),
          ),
        ),
    },
    {
      row: "F14: a 200 with an HTML body",
      answer: () =>
        new Response("<!DOCTYPE html><html><body>Bad gateway</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    },
  ])("answers 502 generation_failed to $row", async ({ answer }) => {
    const response = await generate(answer);
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("generation_failed");
  });

  // Statuses a retry may fix (docs, "Error codes").
  it.each([
    [402, "Insufficient credits"],
    [408, "Request timed out"],
    [429, "Rate limit exceeded"],
    [500, "Internal Server Error"],
    [502, "Provider returned error"],
    [503, "No available provider meets the routing requirements"],
  ])("F15: answers 502 generation_failed to HTTP %i, which a retry may fix", async (status, message) => {
    const response = await generate(() => Response.json(errorBody(status, message), { status }));
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("generation_failed");
  });

  it("F16: answers 502 generation_failed to a network failure", async () => {
    const response = await generate(() => Promise.reject(new TypeError("fetch failed")), "rejected");
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("generation_failed");
  });

  // Statuses that mean our request, key or model is wrong: retrying cannot help.
  it.each([
    [400, "Invalid request"],
    [401, "Invalid credentials"],
    [404, "Model not found"],
  ])("C1: answers 500 server_error to HTTP %i, our misconfiguration", async (status, message) => {
    const response = await generate(() => Response.json(errorBody(status, message), { status }));
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("server_error");
  });

  // Pins: each asserts the desired answer, which today's code does not give. it.fails
  // passes while the gap is open and turns red once it is fixed: then flip it to it.
  it.fails(
    "KNOWN GAP #40: answers 502 to a truncated completion whose JSON still parses (finish_reason length)",
    async () => {
      const response = await generate(() =>
        Response.json(completionBody(cardsJson(VALID), { finish_reason: "length" })),
      );
      expect(response.status).toBe(502);
      expect(await errorCode(response)).toBe("generation_failed");
    },
  );

  it.fails(
    "KNOWN GAP #40: answers 502 to a filtered completion whose JSON still parses (finish_reason content_filter)",
    async () => {
      const response = await generate(() =>
        Response.json(completionBody(cardsJson(VALID), { finish_reason: "content_filter" })),
      );
      expect(response.status).toBe(502);
      expect(await errorCode(response)).toBe("generation_failed");
    },
  );

  it.fails(
    "KNOWN GAP #41: answers 502 to a choice that carries an error object, even with finish_reason stop",
    async () => {
      const response = await generate(() =>
        Response.json(
          completionBody(cardsJson(VALID), {
            error: { code: 502, message: "Provider returned error", metadata: { error_type: "provider_unavailable" } },
          }),
        ),
      );
      expect(response.status).toBe(502);
      expect(await errorCode(response)).toBe("generation_failed");
    },
  );
});
