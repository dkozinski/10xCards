import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationError, generateProposals } from "./generation";

const SOURCE = `Fotosynteza zachodzi w chloroplastach. ${"Tekst źródłowy. ".repeat(40)}`;
const KEY = "sk-or-test";

type Init = RequestInit & { body: string };

function completion(content: unknown, extra: Record<string, unknown> = {}) {
  return Response.json({
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0001 },
    ...extra,
  });
}

// Records every call so tests can assert on what was actually sent.
function stubFetch(response: Response | (() => Promise<Response>)) {
  return vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
    typeof response === "function" ? response() : Promise.resolve(response),
  );
}

interface JsonSchemaNode {
  additionalProperties?: boolean;
  maxItems?: number;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
}

// The fields of the OpenRouter request body these tests assert on.
interface SentBody {
  models: string[];
  max_tokens: number;
  provider: Record<string, unknown>;
  messages: { role: string; content: string }[];
  response_format: { type: string; json_schema: { strict: boolean; schema: JsonSchemaNode } };
}

function sentBody(fetchImpl: ReturnType<typeof stubFetch>) {
  const init = fetchImpl.mock.calls[0][1] as Init;
  return JSON.parse(init.body) as SentBody;
}

async function failure(promise: Promise<unknown>): Promise<GenerationError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(GenerationError);
  return error as GenerationError;
}

function expectNoSourceText(error: GenerationError) {
  expect(error.message).not.toContain("Fotosynteza");
  expect(JSON.stringify(error)).not.toContain("Fotosynteza");
}

// A fetch that never answers on its own and rejects once the signal aborts.
function hangingFetch() {
  return vi.fn(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("generateProposals — outgoing request", () => {
  it("sends the privacy flags, the strict schema and the text only as the user message", async () => {
    const fetchImpl = stubFetch(completion({ cards: [{ front: "Q", back: "A" }] }));
    await generateProposals(KEY, { text: SOURCE }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, Init];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);

    const body = sentBody(fetchImpl);
    expect(body.provider).toEqual({ zdr: true, data_collection: "deny", require_parameters: true });
    // Literal values on purpose: the model IDs must exist on OpenRouter, and
    // max_tokens is coupled to the 60 s timeout (~70 tok/s × 3500 ≈ 50 s).
    expect(body.models).toEqual(["google/gemini-3.1-flash-lite", "mistralai/mistral-small-2603"]);
    expect(body.max_tokens).toBe(3500);

    const format = body.response_format;
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema).not.toHaveProperty("$schema");
    expect(format.json_schema.schema.additionalProperties).toBe(false);
    const cards = format.json_schema.schema.properties?.cards;
    expect(cards?.maxItems).toBe(20);
    expect(cards?.items?.additionalProperties).toBe(false);

    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).not.toContain(SOURCE);
    expect(body.messages[1]).toEqual({ role: "user", content: SOURCE });
  });
});

describe("generateProposals — results", () => {
  it("returns trimmed proposals and usage", async () => {
    const fetchImpl = stubFetch(completion({ cards: [{ front: "  Co to? ", back: " To.\n" }] }));
    const result = await generateProposals(KEY, { text: SOURCE }, { fetchImpl });
    expect(result.proposals).toEqual([{ front: "Co to?", back: "To." }]);
    expect(result.meta.dropped).toBe(0);
    expect(result.meta.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50, cost: 0.0001 });
  });

  it.each([
    ["null usage", { usage: null }],
    ["null error field", { error: null }],
  ])("still succeeds with a %s", async (_name, extra) => {
    const fetchImpl = stubFetch(completion({ cards: [{ front: "Q", back: "A" }] }, extra));
    const result = await generateProposals(KEY, { text: SOURCE }, { fetchImpl });
    expect(result.proposals).toEqual([{ front: "Q", back: "A" }]);
  });

  it("clears its timer after success", async () => {
    vi.useFakeTimers();
    const fetchImpl = stubFetch(completion({ cards: [{ front: "Q", back: "A" }] }));
    await generateProposals(KEY, { text: SOURCE }, { fetchImpl });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops cards that would not be saveable and counts them", async () => {
    const cards = [
      { front: "Q1", back: "A1" },
      { front: "x".repeat(201), back: "too long front" },
      { front: "   ", back: "blank front" },
      { front: "NUL\0", back: "A" },
      { front: "Q2" }, // missing back
      "not an object",
      { front: "Q3", back: "A3" },
    ];
    const result = await generateProposals(KEY, { text: SOURCE }, { fetchImpl: stubFetch(completion({ cards })) });
    expect(result.proposals).toEqual([
      { front: "Q1", back: "A1" },
      { front: "Q3", back: "A3" },
    ]);
    expect(result.meta.dropped).toBe(5);
  });

  it("caps an over-producing model at 20 proposals", async () => {
    const cards = Array.from({ length: 25 }, (_, i) => ({ front: `Q${i}`, back: `A${i}` }));
    const result = await generateProposals(KEY, { text: SOURCE }, { fetchImpl: stubFetch(completion({ cards })) });
    expect(result.proposals).toHaveLength(20);
    expect(result.proposals[19]).toEqual({ front: "Q19", back: "A19" });
    expect(result.meta.dropped).toBe(5);
  });

  it("fails with no_valid_cards when nothing survives validation", async () => {
    const fetchImpl = stubFetch(completion({ cards: [{ front: "", back: "" }] }));
    expect((await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl }))).kind).toBe("no_valid_cards");
  });

  it("fails with no_valid_cards on an empty list", async () => {
    const fetchImpl = stubFetch(completion({ cards: [] }));
    expect((await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl }))).kind).toBe("no_valid_cards");
  });
});

describe("generateProposals — failures", () => {
  it.each([
    ["non-JSON content", "Here are your cards: ..."],
    ["truncated JSON (finish_reason length)", '{"cards":[{"front":"Q","ba'],
    ["wrong shape", { flashcards: [] }],
  ])("maps %s to invalid_output", async (_name, content) => {
    const fetchImpl = stubFetch(completion(content));
    expect((await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl }))).kind).toBe("invalid_output");
  });

  it("maps null content (empty reply or refusal) to invalid_output", async () => {
    const fetchImpl = stubFetch(Response.json({ choices: [{ message: { content: null } }] }));
    expect((await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl }))).kind).toBe("invalid_output");
  });

  it("maps a 200 with an error body and no choices to upstream_body_error, without echoing it", async () => {
    const fetchImpl = stubFetch(Response.json({ error: { code: 502, message: `provider echoed: ${SOURCE}` } }));
    const error = await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl }));
    expect(error.kind).toBe("upstream_body_error");
    expectNoSourceText(error);
  });

  it("maps finish_reason error with partial content to upstream_body_error", async () => {
    const content = JSON.stringify({ cards: [{ front: "Q", back: "A" }] });
    const fetchImpl = stubFetch(Response.json({ choices: [{ message: { content }, finish_reason: "error" }] }));
    expect((await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl }))).kind).toBe("upstream_body_error");
  });

  it("maps a non-JSON 200 body to upstream_body_error", async () => {
    const fetchImpl = stubFetch(new Response("<html>oops</html>", { status: 200 }));
    expect((await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl }))).kind).toBe("upstream_body_error");
  });

  it.each([402, 429, 502, 503])("maps HTTP %i to upstream_http with the status", async (status) => {
    const fetchImpl = stubFetch(Response.json({ error: { code: status, message: "x" } }, { status }));
    const error = await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl }));
    expect(error.kind).toBe("upstream_http");
    expect(error.status).toBe(status);
  });

  it("maps a network failure to upstream_http without a status", async () => {
    const fetchImpl = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const error = await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl }));
    expect(error.kind).toBe("upstream_http");
    expect(error.status).toBeUndefined();
  });

  it("keeps upstream_http when cancelling the error body rejects", async () => {
    const response = {
      ok: false,
      status: 503,
      body: { cancel: () => Promise.reject(new DOMException("Aborted", "AbortError")) },
    } as unknown as Response;
    const error = await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl: stubFetch(response) }));
    expect(error.kind).toBe("upstream_http");
    expect(error.status).toBe(503);
  });

  it("aborts the upstream call after the 60 s default and maps it to timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = hangingFetch();
    const pending = failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl }));

    await vi.advanceTimersByTimeAsync(59_999);
    const signal = fetchImpl.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).kind).toBe("timeout");
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("maps an abort while reading the body to timeout", async () => {
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      } as unknown as Response),
    );
    const error = await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl, timeoutMs: 10 }));
    expect(error.kind).toBe("timeout");
  });

  it("never puts source text or upstream text into the error message", async () => {
    const fetchImpl = stubFetch(Response.json({ error: { code: 400, message: SOURCE } }, { status: 400 }));
    expectNoSourceText(await failure(generateProposals(KEY, { text: SOURCE }, { fetchImpl })));
  });
});
