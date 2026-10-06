// Shared by the cookie-authenticated JSON routes that accept user text.
// request.text() would buffer up to the platform's 100 MB limit before any check,
// enough to exceed the isolate's memory and CPU. Reject on the declared length,
// then count the bytes actually streamed (Content-Length can be absent) and stop early.
export async function readBody(
  request: Request,
  maxBytes: number,
): Promise<{ text: string } | "too_large" | "unreadable"> {
  if (Number(request.headers.get("Content-Length")) > maxBytes) return "too_large";
  if (!request.body) return { text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return "too_large";
      }
      chunks.push(value);
    }
  } catch {
    // e.g. the client disconnected mid-upload
    return "unreadable";
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
}
