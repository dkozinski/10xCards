// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProposalReview from "./ProposalReview";

// The review through its three props, the contract GenerateProposals mounts it with,
// with only fetch and location stubbed. Each test asserts what the user can still do
// (which controls are enabled, what the alert says) and what goes over the wire.
// Expected bodies are literal data from the owner decisions (PRD FR-005–FR-007 and
// Open Question 3; review-and-save-proposals/plan.md:43, :92-93, :267, :384-398),
// never built with proposalSource or from the component's own branches.

const GENERATION_ID = "3f6c1a2e-8b4d-4c7a-9e21-5d0b7f3a9c64";

const PROPOSALS = [
  { front: "Gdzie zachodzi fotosynteza?", back: "W chloroplastach." },
  { front: "Jaki gaz jest produktem ubocznym fotosyntezy?", back: "Tlen." },
  { front: "Co jest źródłem energii w fotosyntezie?", back: "Światło słoneczne." },
  { front: "Jak nazywa się zielony barwnik roślin?", back: "Chlorofil." },
];

const failure = (status: number, code: string, details?: unknown) =>
  Response.json({ error: { code, message: "x", ...(details ? { details } : {}) } }, { status });

const saved = (count: number) => Response.json({ saved_count: count });

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn<(url: string | URL) => void>();
const onDiscarded = vi.fn<() => void>();

function sentTo(index: number) {
  const call = fetchMock.mock.calls.at(index);
  if (!call) throw new Error(`no request #${index}`);
  const [url, init] = call;
  if (typeof url !== "string" || typeof init?.body !== "string")
    throw new Error(`request #${index} is not a JSON post`);
  return { url, method: init.method, raw: init.body, body: JSON.parse(init.body) as unknown, signal: init.signal };
}

function setup(proposals = PROPOSALS) {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign });
  const user = userEvent.setup();
  render(<ProposalReview generationId={GENERATION_ID} proposals={proposals} onDiscarded={onDiscarded} />);
  return user;
}

const button = (name: string) => screen.getByRole("button", { name });
const tryAgain = () => screen.queryByRole("button", { name: "Try again" });

// The n-th card in list order, 1-based like the controls' labels.
function card(n: number) {
  const item = screen.getAllByRole("listitem").at(n - 1);
  if (!item) throw new Error(`no card ${n}`);
  return item;
}

// Every per-card control: Edit, Done editing, Revert, Reject and Restore.
const cardControls = () => screen.getAllByRole("button", { name: /proposal \d/ });

// True while leaving the page would show the browser's "Leave site?" prompt.
function leavingIsBlocked() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  assign.mockReset();
  onDiscarded.mockReset();
  vi.unstubAllGlobals();
});

describe("ProposalReview — what a save sends", () => {
  it("RV-1: sends exactly the approved set in its post-edit wording, then leaves for the deck", async () => {
    fetchMock.mockResolvedValueOnce(saved(3));
    const user = setup();

    await user.click(button("Reject proposal 2"));
    // left open: Save, not Done, ends this edit
    await user.click(button("Edit proposal 3"));
    const back3 = within(card(3)).getByLabelText("Back");
    await user.clear(back3);
    await user.type(back3, "Energia światła słonecznego.");
    // whitespace only: still the card the AI proposed
    await user.click(button("Edit proposal 4"));
    await user.type(within(card(4)).getByLabelText("Back"), "   ");
    await user.click(button("Done editing proposal 4"));
    expect(leavingIsBlocked()).toBe(true);

    await user.click(button("Save 3 cards"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/deck");
    });
    expect(assign).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sentTo(0)).toMatchObject({ url: "/api/generations", method: "POST" });
    expect(sentTo(0).body).toEqual({
      generation_id: GENERATION_ID,
      generated_count: 4,
      cards: [
        { front: "Gdzie zachodzi fotosynteza?", back: "W chloroplastach.", source: "ai" },
        { front: "Co jest źródłem energii w fotosyntezie?", back: "Energia światła słonecznego.", source: "ai_edited" },
        { front: "Jak nazywa się zielony barwnik roślin?", back: "Chlorofil.", source: "ai" },
      ],
    });
    // the page's own navigation after the save must not ask "Leave site?"
    expect(leavingIsBlocked()).toBe(false);
  });

  it("RV-2: an edit reverted to the original saves the original wording as ai", async () => {
    fetchMock.mockResolvedValueOnce(saved(2));
    const user = setup(PROPOSALS.slice(0, 2));

    await user.click(button("Edit proposal 1"));
    const front1 = within(card(1)).getByLabelText("Front");
    await user.clear(front1);
    await user.type(front1, "W której części komórki zachodzi fotosynteza?");
    await user.click(button("Done editing proposal 1"));
    await user.click(button("Revert proposal 1 to the original"));
    await user.click(button("Save 2 cards"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/deck");
    });
    expect(sentTo(0).body).toEqual({
      generation_id: GENERATION_ID,
      generated_count: 2,
      cards: [
        { front: "Gdzie zachodzi fotosynteza?", back: "W chloroplastach.", source: "ai" },
        { front: "Jaki gaz jest produktem ubocznym fotosyntezy?", back: "Tlen.", source: "ai" },
      ],
    });
  });

  it("RV-3: a double click on Save sends one request", async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    fetchMock.mockReturnValueOnce(promise);
    const user = setup(PROPOSALS.slice(0, 2));

    await user.dblClick(button("Save 2 cards"));

    expect(button("Saving…")).toBeDisabled();
    // a card rejected now would still be saved: the request in flight already carries it
    for (const control of cardControls()) expect(control).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledOnce();

    await act(async () => {
      resolve(saved(2));
      await promise;
    });

    await waitFor(() => {
      expect(assign).toHaveBeenCalledOnce();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("ProposalReview — after a failed save", () => {
  it.each<{ row: string; answer: () => Promise<Response> }>([
    { row: "a network failure", answer: () => Promise.reject(new TypeError("Failed to fetch")) },
    { row: "500 server_error", answer: () => Promise.resolve(failure(500, "server_error")) },
    // a proxy or platform page: the save behind it may still have committed
    { row: "a 200 without saved_count", answer: () => Promise.resolve(Response.json({})) },
    {
      row: "a 200 with an HTML body",
      answer: () =>
        Promise.resolve(
          new Response("<!DOCTYPE html><html><body>Bad gateway</body></html>", {
            headers: { "Content-Type": "text/html" },
          }),
        ),
    },
  ])("RV-4: locks the list after $row, and Try again resends the identical command", async ({ answer }) => {
    fetchMock.mockImplementationOnce(answer).mockResolvedValueOnce(saved(2));
    const user = setup(PROPOSALS.slice(0, 3));

    // an edited card puts Revert among the controls the freeze must lock
    await user.click(button("Edit proposal 1"));
    const front1 = within(card(1)).getByLabelText("Front");
    await user.clear(front1);
    await user.type(front1, "W której części komórki zachodzi fotosynteza?");
    await user.click(button("Done editing proposal 1"));
    await user.click(button("Reject proposal 2"));
    await user.click(button("Save 2 cards"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/try again/i);
    // the first attempt may have committed: a change now would be silently dropped
    expect(cardControls()).toHaveLength(6);
    for (const control of cardControls()) expect(control).toBeDisabled();
    expect(button("Save 2 cards")).toBeDisabled();
    expect(tryAgain()).toBeEnabled();
    // without a deadline, a hung save stays pending until the edge gives up
    const { signal } = sentTo(0);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    await user.click(button("Try again"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/deck");
    });
    expect(assign).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // the same generation_id and payload make a committed first attempt a replay
    expect(sentTo(1).raw).toBe(sentTo(0).raw);
    expect(sentTo(0).body).toMatchObject({ generation_id: GENERATION_ID });
  });

  it("RV-5: a validation error unlocks the list and marks the card that was sent at that index", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        failure(400, "validation_failed", {
          fieldErrors: { "cards.1.front": ["Front contains characters that cannot be saved"] },
        }),
      )
      .mockResolvedValueOnce(saved(2));
    const user = setup(PROPOSALS.slice(0, 3));

    await user.click(button("Reject proposal 1"));
    await user.click(button("Save 2 cards"));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    // cards 2 and 3 were sent, so cards.1 is the third card in the list
    const front3 = await within(card(3)).findByLabelText("Front");
    expect(front3).toBeInvalid();
    expect(front3).toHaveAccessibleDescription("Front contains characters that cannot be saved");
    expect(within(card(2)).queryByLabelText("Front")).not.toBeInTheDocument();
    // the failing card may be off-screen in a list of 20, so the alert says how many
    expect(screen.getByRole("alert")).toHaveTextContent(/1 card/);
    // a 400 comes before the database, so nothing was written and the list is the user's again
    expect(tryAgain()).not.toBeInTheDocument();
    for (const control of cardControls()) expect(control).toBeEnabled();

    await user.clear(front3);
    await user.type(front3, "Skąd rośliny czerpią energię do fotosyntezy?");
    await user.click(button("Save 2 cards"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/deck");
    });
    expect(sentTo(2).body).toEqual({
      generation_id: GENERATION_ID,
      generated_count: 3,
      cards: [
        { front: "Jaki gaz jest produktem ubocznym fotosyntezy?", back: "Tlen.", source: "ai" },
        { front: "Skąd rośliny czerpią energię do fotosyntezy?", back: "Światło słoneczne.", source: "ai_edited" },
      ],
    });
  });

  it("RV-5: marks a card past the tenth by its two-digit index", async () => {
    const proposals = Array.from({ length: 12 }, (_, i) => ({
      front: `Pytanie ${i + 1}?`,
      back: `Odpowiedź ${i + 1}.`,
    }));
    fetchMock.mockResolvedValueOnce(
      failure(400, "validation_failed", { fieldErrors: { "cards.10.back": ["Back must be at most 500 characters"] } }),
    );
    const user = setup(proposals);

    await user.click(button("Save 12 cards"));

    const back11 = await within(card(11)).findByLabelText("Back");
    expect(back11).toBeInvalid();
    expect(back11).toHaveAccessibleDescription("Back must be at most 500 characters");
  });

  it("RV-5: a validation error that names no card says the save failed and leaves the list editable", async () => {
    // what the route answers for a body over its size cap
    fetchMock.mockResolvedValueOnce(
      failure(400, "validation_failed", { fieldErrors: { _root: ["Request body is too large"] } }),
    );
    const user = setup(PROPOSALS.slice(0, 2));

    await user.click(button("Save 2 cards"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
    expect(tryAgain()).not.toBeInTheDocument();
    expect(button("Save 2 cards")).toBeEnabled();
    for (const control of cardControls()) expect(control).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("RV-6: a 401 on a first attempt keeps the list editable and the review on the page", async () => {
    fetchMock.mockResolvedValueOnce(failure(401, "unauthorized")).mockResolvedValueOnce(saved(2));
    const user = setup(PROPOSALS.slice(0, 2));

    await user.click(button("Save 2 cards"));

    // signing in from this tab would leave the page and lose the review
    expect(await screen.findByRole("alert")).toHaveTextContent(/another tab/i);
    expect(tryAgain()).not.toBeInTheDocument();
    for (const control of cardControls()) expect(control).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
    expect(leavingIsBlocked()).toBe(true);

    // signed in elsewhere, the user saves from the same review
    await user.click(button("Save 2 cards"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/deck");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("RV-6: a 401 after an ambiguous failure keeps the list locked and the command identical", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(failure(401, "unauthorized"))
      .mockResolvedValueOnce(saved(1));
    const user = setup(PROPOSALS.slice(0, 2));

    await user.click(button("Reject proposal 2"));
    await user.click(button("Save 1 card"));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText(/another tab/i)).toBeInTheDocument();
    // the first attempt may still have committed
    for (const control of cardControls()) expect(control).toBeDisabled();
    expect(button("Save 1 card")).toBeDisabled();
    expect(leavingIsBlocked()).toBe(true);

    await user.click(button("Try again"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/deck");
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sentTo(1).raw).toBe(sentTo(0).raw);
    expect(sentTo(2).raw).toBe(sentTo(0).raw);
  });
});

describe("ProposalReview — discarding and invalid cards", () => {
  it("RV-7: rejecting every card discards: an empty save, the parent told once, no navigation", async () => {
    fetchMock.mockResolvedValueOnce(saved(0));
    const user = setup(PROPOSALS.slice(0, 3));

    await user.click(button("Reject proposal 1"));
    await user.click(button("Reject proposal 2"));
    await user.click(button("Reject proposal 3"));
    await user.click(button("Discard all"));

    await waitFor(() => {
      expect(onDiscarded).toHaveBeenCalledOnce();
    });
    expect(sentTo(0).body).toEqual({ generation_id: GENERATION_ID, generated_count: 3, cards: [] });
    expect(assign).not.toHaveBeenCalled();
  });

  it("RV-8: an invalid kept card blocks the save and opens its editor; a rejected one does not", async () => {
    fetchMock.mockResolvedValueOnce(saved(2));
    const user = setup(PROPOSALS.slice(0, 3));

    // emptied, then rejected and restored: kept and invalid, with its editor closed
    await user.click(button("Edit proposal 1"));
    await user.clear(within(card(1)).getByLabelText("Front"));
    await user.click(button("Reject proposal 1"));
    await user.click(button("Restore proposal 1"));
    expect(within(card(1)).queryByLabelText("Front")).not.toBeInTheDocument();
    await user.click(button("Save 3 cards"));

    const front1 = within(card(1)).getByLabelText("Front");
    expect(front1).toBeInvalid();
    expect(front1).toHaveAccessibleDescription(/required/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/1 card/);
    expect(fetchMock).not.toHaveBeenCalled();

    // the same card, rejected, no longer blocks
    await user.click(button("Reject proposal 1"));
    await user.click(button("Save 2 cards"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/deck");
    });
    expect(sentTo(0).body).toEqual({
      generation_id: GENERATION_ID,
      generated_count: 3,
      cards: [
        { front: "Jaki gaz jest produktem ubocznym fotosyntezy?", back: "Tlen.", source: "ai" },
        { front: "Co jest źródłem energii w fotosyntezie?", back: "Światło słoneczne.", source: "ai" },
      ],
    });
  });
});

describe("ProposalReview — known gaps", () => {
  // Pins: each asserts the desired answer, which today's code does not give. it.fails
  // passes while the gap is open and turns red once it is fixed: then flip it to it.

  it.fails(
    "KNOWN GAP #43: shows Could not save and unlocks the list on validation_failed without fieldErrors",
    async () => {
      fetchMock.mockResolvedValueOnce(failure(400, "validation_failed", {}));
      const user = setup(PROPOSALS.slice(0, 2));
      // The TypeError rejects save(), which nobody awaits; a listener of our own
      // keeps Vitest from reporting it as an unhandled rejection.
      const swallow = () => undefined;
      process.on("unhandledRejection", swallow);
      try {
        await user.click(button("Save 2 cards"));

        // the desired outcome, never the error: once #43 is fixed there is no error to wait for
        expect(await screen.findByText("Could not save. Please try again.", {}, { timeout: 500 })).toBeInTheDocument();
        expect(button("Save 2 cards")).toBeEnabled();
        for (const control of cardControls()) expect(control).toBeEnabled();
      } finally {
        process.off("unhandledRejection", swallow);
      }
    },
  );
});
