import { AuthApiError, AuthRetryableFetchError, AuthUnknownError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_UNAVAILABLE_MESSAGE, authErrorMessage } from "./auth-errors";

describe("authErrorMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["wrong credentials (400)", new AuthApiError("Invalid login credentials", 400, "invalid_credentials")],
    ["a weak password (422)", new AuthWeakPasswordError("Password should be at least 6 characters.", 422, ["length"])],
    ["a rate limit (429)", new AuthApiError("email rate limit exceeded", 429, "over_email_send_rate_limit")],
  ])("passes through %s unchanged, without logging", (_, error) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(authErrorMessage(error)).toBe(error.message);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ["a gateway error", new AuthRetryableFetchError("{}", 503)],
    ["a network failure", new AuthRetryableFetchError("{}", 0)],
    ["a non-JSON response", new AuthUnknownError("Unexpected token '<'", new SyntaxError())],
    ["a 5xx with a server message", new AuthApiError("Database error saving new user", 500, "unexpected_failure")],
  ])("replaces %s with the unavailable message and logs it once", (_, error) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(authErrorMessage(error)).toBe(AUTH_UNAVAILABLE_MESSAGE);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
