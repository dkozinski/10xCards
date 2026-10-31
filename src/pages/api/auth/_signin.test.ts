import { inspect } from "node:util";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_UNAVAILABLE_MESSAGE } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase";
import { POST } from "./signin";

// The real module imports astro:env/server, which only exists inside Astro.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const email = "someone@example.com";

function stubSignIn(error: unknown) {
  vi.mocked(createClient).mockReturnValue({
    auth: { signInWithPassword: () => Promise.resolve({ data: {}, error }) },
  } as unknown as ReturnType<typeof createClient>);
}

function signIn() {
  const body = new FormData();
  body.set("email", email);
  body.set("password", "a-password");
  const request = new Request("http://localhost/api/auth/signin", { method: "POST", body });
  const redirect = (url: string) => new Response(null, { status: 302, headers: { Location: url } });
  return POST({ request, cookies: {}, redirect } as unknown as APIContext);
}

describe("POST /api/auth/signin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the unavailable message when Supabase is unreachable, and keeps the email out of the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubSignIn(new AuthRetryableFetchError("{}", 503));

    const response = await signIn();

    expect(response.headers.get("Location")).toBe(`/auth/signin?error=${encodeURIComponent(AUTH_UNAVAILABLE_MESSAGE)}`);
    expect(log).toHaveBeenCalledTimes(1);
    expect(inspect(log.mock.calls, { depth: null })).not.toContain(email);
  });

  it("passes wrong-credential errors through unchanged", async () => {
    stubSignIn(new AuthApiError("Invalid login credentials", 400, "invalid_credentials"));

    const response = await signIn();

    expect(response.headers.get("Location")).toBe("/auth/signin?error=Invalid%20login%20credentials");
  });

  it("redirects home on success", async () => {
    stubSignIn(null);

    const response = await signIn();

    expect(response.headers.get("Location")).toBe("/");
  });
});
