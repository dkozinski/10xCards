// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import GenerateProposals from "./GenerateProposals";

// The island exactly as src/pages/generate.astro mounts it, with only fetch stubbed.
// Each test asserts what the user sees (the field, the buttons, the alert) and what
// goes over the wire. Expected affordances come from the archived owner decisions
// (ai-proposals-from-text/plan.md:459, :481; review-and-save-proposals/plan.md:43,
// :419), never from the component's own branches.

// At least 500 characters, with no surrounding whitespace, so the text the field
// holds and the text the request carries are the same string.
const TEXT = Array.from({ length: 20 }, () => "Fotosynteza zachodzi w chloroplastach.").join(" ");

const PROPOSALS = [
  { front: "Gdzie zachodzi fotosynteza?", back: "W chloroplastach." },
  { front: "Jaki gaz jest produktem ubocznym fotosyntezy?", back: "Tlen." },
];

const failure = (status: number, code: string, details?: unknown) =>
  Response.json({ error: { code, message: "x", ...(details ? { details } : {}) } }, { status });

const fetchMock = vi.fn<typeof fetch>();

function sentTo(index: number) {
  const call = fetchMock.mock.calls.at(index);
  if (!call) throw new Error(`no request #${index}`);
  const [url, init] = call;
  if (typeof url !== "string" || typeof init?.body !== "string")
    throw new Error(`request #${index} is not a JSON post`);
  return { url, method: init.method, body: JSON.parse(init.body) as unknown, signal: init.signal };
}

// Renders the island and pastes the text: typing 779 characters would fire one
// event per character.
async function setup(text = TEXT) {
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<GenerateProposals />);
  const field = screen.getByLabelText("Source text");
  await user.click(field);
  await user.paste(text);
  return { user, field };
}

const generateButton = () => screen.getByRole("button", { name: /Generate proposals|Generating…/ });
const tryAgain = () => screen.queryByRole("button", { name: "Try again" });

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("GenerateProposals — after a failed generation", () => {
  it.each<{ row: string; answer: () => Promise<Response>; retry: boolean }>([
    {
      row: "502 generation_failed",
      answer: () => Promise.resolve(failure(502, "generation_failed")),
      retry: true,
    },
    {
      row: "a client timeout",
      answer: () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
      retry: true,
    },
    {
      row: "a network failure",
      answer: () => Promise.reject(new TypeError("Failed to fetch")),
      retry: true,
    },
    {
      // "a 200 without a list" is transient, and never an empty review
      row: "a 200 with an empty proposal list",
      answer: () => Promise.resolve(Response.json({ proposals: [] })),
      retry: true,
    },
    {
      row: "a 200 with an HTML body",
      answer: () =>
        Promise.resolve(
          new Response("<!DOCTYPE html><html><body>Bad gateway</body></html>", {
            headers: { "Content-Type": "text/html" },
          }),
        ),
      retry: true,
    },
    {
      // a misconfiguration: retrying cannot help
      row: "500 server_error",
      answer: () => Promise.resolve(failure(500, "server_error")),
      retry: false,
    },
  ])("GS-1: keeps the text and re-enables Generate after $row", async ({ answer, retry }) => {
    fetchMock.mockImplementationOnce(answer);
    const { user, field } = await setup();

    await user.click(generateButton());

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(field).toHaveValue(TEXT);
    expect(generateButton()).toBeEnabled();
    expect(generateButton()).toHaveAccessibleName("Generate proposals");
    if (retry) expect(tryAgain()).toBeInTheDocument();
    else expect(tryAgain()).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Proposals/ })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("GS-1: sends every generation with a client deadline", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    const { user } = await setup();

    await user.click(generateButton());
    await screen.findByRole("alert");

    // without it, a hung connection spins until the edge gives up (~100 s)
    const { signal } = sentTo(0);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("GS-2: a retry after a 502 resends the same text and reaches the review", async () => {
    fetchMock
      .mockResolvedValueOnce(failure(502, "generation_failed"))
      .mockResolvedValueOnce(Response.json({ proposals: PROPOSALS }));
    const { user, field } = await setup();

    await user.click(generateButton());
    const retry = await screen.findByRole("button", { name: "Try again" });
    await user.click(retry);

    expect(await screen.findByRole("heading", { name: "Proposals (2)" })).toBeInTheDocument();
    expect(screen.getByText(PROPOSALS[0].front)).toBeInTheDocument();
    expect(screen.getByText(PROPOSALS[1].front)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(field).toHaveValue(TEXT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentTo(0)).toMatchObject({ url: "/api/proposals", method: "POST", body: { text: TEXT } });
    expect(sentTo(1)).toMatchObject({ url: "/api/proposals", method: "POST", body: { text: TEXT } });
  });

  it.each([
    {
      row: "the field's message",
      fieldErrors: { text: ["Text contains characters that cannot be processed"] },
      shown: "Text contains characters that cannot be processed",
    },
    {
      // fieldErrors without a text entry still gets a message, never a silent field
      row: "a generic message when no text error is named",
      fieldErrors: {},
      shown: "Invalid text.",
    },
  ])("GS-4: shows a server validation error under the field with $row", async ({ fieldErrors, shown }) => {
    fetchMock.mockResolvedValueOnce(failure(400, "validation_failed", { fieldErrors }));
    const { user, field } = await setup();

    await user.click(generateButton());

    expect(await screen.findByText(shown)).toBeInTheDocument();
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(expect.stringContaining(shown));
    expect(field).toHaveValue(TEXT);
    expect(generateButton()).toBeEnabled();
  });

  it("refuses a text under 500 characters without sending it", async () => {
    const { user, field } = await setup("Za krótki tekst.");

    await user.click(generateButton());

    expect(await screen.findByText("Text must be at least 500 characters")).toBeInTheDocument();
    expect(field).toBeInvalid();
    expect(field).toHaveValue("Za krótki tekst.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GS-5: asks to sign in again after a 401, offers no retry and keeps the text", async () => {
    fetchMock.mockResolvedValueOnce(failure(401, "unauthorized"));
    const { user, field } = await setup();

    await user.click(generateButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/sign in/i);
    expect(tryAgain()).not.toBeInTheDocument();
    expect(field).toHaveValue(TEXT);
    expect(generateButton()).toBeEnabled();
  });
});

describe("GenerateProposals — one generation at a time", () => {
  it("GS-3: a second submit while generating sends nothing", async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    fetchMock.mockReturnValueOnce(promise);
    const { user } = await setup();

    await user.dblClick(generateButton());

    expect(generateButton()).toHaveAccessibleName("Generating…");
    expect(generateButton()).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledOnce();

    // resolved at once: the 1 s elapsed-time tick must not land outside act
    await act(async () => {
      resolve(Response.json({ proposals: PROPOSALS }));
      await promise;
    });

    expect(await screen.findByRole("heading", { name: "Proposals (2)" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("GS-6: an undecided review blocks a new generation", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ proposals: PROPOSALS }));
    const { user } = await setup();

    await user.click(generateButton());
    await screen.findByRole("heading", { name: "Proposals (2)" });

    expect(generateButton()).toHaveAttribute("aria-disabled", "true");
    expect(generateButton()).toHaveAccessibleDescription("Save or discard these proposals first.");

    await user.click(generateButton());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Proposals (2)" })).toBeInTheDocument();
  });

  it("GS-7: discarding every proposal returns to the text, ready to generate again", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ proposals: PROPOSALS }))
      .mockResolvedValueOnce(Response.json({ saved_count: 0 }))
      .mockResolvedValueOnce(failure(502, "generation_failed"));
    const { user, field } = await setup();

    await user.click(generateButton());
    await screen.findByRole("heading", { name: "Proposals (2)" });
    await user.click(screen.getByRole("button", { name: "Reject proposal 1" }));
    await user.click(screen.getByRole("button", { name: "Reject proposal 2" }));
    await user.click(screen.getByRole("button", { name: "Discard all" }));

    await screen.findByText("Proposals discarded");
    expect(screen.queryByRole("heading", { name: /Proposals/ })).not.toBeInTheDocument();
    expect(sentTo(1)).toMatchObject({ url: "/api/generations", body: { cards: [] } });
    expect(field).toHaveValue(TEXT);
    expect(generateButton()).toBeEnabled();
    expect(generateButton()).not.toHaveAttribute("aria-disabled");

    await user.click(generateButton());

    await screen.findByRole("alert");
    expect(sentTo(2)).toMatchObject({ url: "/api/proposals", body: { text: TEXT } });
    // the screen reader no longer hears about the previous discard
    expect(screen.queryByText("Proposals discarded")).not.toBeInTheDocument();
  });
});

describe("GenerateProposals — known gaps", () => {
  // Pins: each asserts the desired answer, which today's code does not give. it.fails
  // passes while the gap is open and turns red once it is fixed: then flip it to it.

  it.fails("KNOWN GAP #42: keeps the text and shows an alert when a proposal is null", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ proposals: [null] }));
    const { user } = await setup();
    // React reports the render error on window; without preventDefault the jsdom
    // environment re-raises it as an unhandled error that fails the whole run.
    // React also logs it with console.warn ("An error occurred in <ProposalReview>").
    const swallow = (event: ErrorEvent) => {
      event.preventDefault();
    };
    window.addEventListener("error", swallow);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await user.click(generateButton());

      // the desired outcome, never the error: once #42 is fixed there is no error to wait for
      expect(await screen.findByRole("alert", {}, { timeout: 500 })).toBeInTheDocument();
      expect(screen.getByLabelText("Source text")).toHaveValue(TEXT);
      expect(generateButton()).toBeEnabled();
    } finally {
      warn.mockRestore();
      window.removeEventListener("error", swallow);
    }
  });

  it.fails(
    "KNOWN GAP #43: clears the spinner and shows an inline error on validation_failed without fieldErrors",
    async () => {
      fetchMock.mockResolvedValueOnce(failure(400, "validation_failed", {}));
      const { user, field } = await setup();
      // The TypeError rejects generate(), which nobody awaits; a listener of our own
      // keeps Vitest from reporting it as an unhandled rejection.
      const swallow = () => undefined;
      process.on("unhandledRejection", swallow);
      try {
        await user.click(generateButton());

        // under 1 s: on today's code pending never clears, so the elapsed tick keeps running
        expect(await screen.findByText("Invalid text.", {}, { timeout: 500 })).toBeInTheDocument();
        expect(field).toHaveValue(TEXT);
        expect(generateButton()).toBeEnabled();
      } finally {
        process.off("unhandledRejection", swallow);
      }
    },
  );
});
