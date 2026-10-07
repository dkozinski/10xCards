import { describe, expect, it } from "vitest";
import { readBody } from "./read-body";

function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("http://localhost/", { method: "POST", headers, body, duplex: "half" } as RequestInit);
}

// A streamed body: the Request carries no Content-Length, so only byte counting can stop it.
function stream(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("readBody", () => {
  it("returns a body within the cap, decoded as UTF-8", async () => {
    await expect(readBody(request('{"a":"żółw"}'), 64)).resolves.toEqual({ text: '{"a":"żółw"}' });
  });

  it("rejects on a declared Content-Length over the cap without reading", async () => {
    await expect(readBody(request("x", { "Content-Length": "65" }), 64)).resolves.toBe("too_large");
  });

  it("rejects a streamed body over the cap that declares no length", async () => {
    const req = request(stream(["x".repeat(40), "x".repeat(40)]));
    expect(req.headers.get("Content-Length")).toBeNull();
    await expect(readBody(req, 64)).resolves.toBe("too_large");
  });

  it("accepts a streamed body of exactly the cap", async () => {
    await expect(readBody(request(stream(["x".repeat(32), "x".repeat(32)])), 64)).resolves.toEqual({
      text: "x".repeat(64),
    });
  });
});
