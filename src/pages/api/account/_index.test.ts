import { inspect } from "node:util";
import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createClient } from "@/lib/supabase";
import { DELETE } from "./index";

// The real module imports astro:env/server, which only exists inside Astro.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const user = { id: "00000000-0000-0000-0000-00000000000a", email: "dawid@example.com" };

interface Stub {
  rpc?: { data?: unknown; error?: unknown };
  signOutError?: unknown;
  signOutThrows?: Error;
}

// rpc("delete_my_account") and auth.signOut({ scope }); calls are recorded in
// one list so the test can check their order
function stubClient(stub: Stub = {}) {
  const calls: string[] = [];
  const rpc = vi.fn(() => {
    calls.push("rpc");
    return Promise.resolve({ data: stub.rpc?.data ?? true, error: stub.rpc?.error ?? null });
  });
  const signOut = vi.fn(() => {
    calls.push("signOut");
    if (stub.signOutThrows) return Promise.reject(stub.signOutThrows);
    return Promise.resolve({ error: stub.signOutError ?? null });
  });
  vi.mocked(createClient).mockReturnValue({ rpc, auth: { signOut } } as unknown as ReturnType<typeof createClient>);
  return { rpc, signOut, calls };
}

function remove(body: string, opts: { user?: unknown } = {}) {
  const request = new Request("http://localhost/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const locals = { user: "user" in opts ? opts.user : user };
  return DELETE({ request, locals, cookies: {} } as unknown as APIContext);
}

async function errorOf(response: Response) {
  const body = (await response.json()) as {
    error: { code: string; details?: { fieldErrors?: Record<string, string[]> } };
  };
  return body.error;
}

const valid = JSON.stringify({ confirm_email: "dawid@example.com" });

describe("DELETE /api/account", () => {
  let logError: MockInstance;
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects a request without a session before touching Supabase", async () => {
    stubClient();
    const response = await remove(valid, { user: null });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("unauthorized");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("reports a missing Supabase configuration", async () => {
    vi.mocked(createClient).mockReturnValue(null);
    const response = await remove(valid);
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_error");
  });

  it("answers invalid_json for a body that is not JSON", async () => {
    const { rpc } = stubClient();
    const response = await remove("{not json");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("invalid_json");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers validation_failed when the confirmation is missing", async () => {
    const { rpc } = stubClient();
    const response = await remove("{}");
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("validation_failed");
    expect(error.details?.fieldErrors?.confirm_email).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a confirmation that is not the account's email, without deleting", async () => {
    const { rpc, signOut } = stubClient();
    const response = await remove(JSON.stringify({ confirm_email: "someone@example.com" }));
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("validation_failed");
    expect(error.details?.fieldErrors?.confirm_email).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("refuses any confirmation when the account has no email", async () => {
    const { rpc } = stubClient();
    const response = await remove(JSON.stringify({ confirm_email: "x" }), { user: { id: user.id } });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("validation_failed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("deletes the account, then signs out, and answers 204 with no body", async () => {
    const { rpc, signOut, calls } = stubClient();
    const response = await remove(JSON.stringify({ confirm_email: " Dawid@Example.com " }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(rpc).toHaveBeenCalledWith("delete_my_account");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(calls).toEqual(["rpc", "signOut"]);
  });

  it("answers 204 when the account was already gone", async () => {
    const { signOut } = stubClient({ rpc: { data: false } });
    const response = await remove(valid);
    expect(response.status).toBe(204);
    expect(signOut).toHaveBeenCalled();
  });

  it("still answers 204 when signing out fails after the delete", async () => {
    stubClient({ signOutError: { code: "unexpected_failure", message: "network" } });
    const response = await remove(valid);
    expect(response.status).toBe(204);
    expect(logError).toHaveBeenCalled();
  });

  it("still answers 204 when signing out throws after the delete", async () => {
    stubClient({ signOutThrows: new Error("cookie write failed") });
    const response = await remove(valid);
    expect(response.status).toBe(204);
    expect(logError).toHaveBeenCalled();
  });

  it("hides a database failure behind server_error and keeps the session", async () => {
    const { signOut } = stubClient({
      rpc: { error: { code: "40P01", message: "deadlock detected", details: "SECRET" } },
    });
    const response = await remove(valid);
    expect(response.status).toBe(500);
    const error = await errorOf(response);
    expect(error.code).toBe("server_error");
    expect(JSON.stringify(error)).not.toContain("deadlock");
    expect(signOut).not.toHaveBeenCalled();
    expect(inspect(logError.mock.calls, { depth: null })).not.toContain("SECRET");
  });

  it("never logs the user's email or id", async () => {
    stubClient({ rpc: { error: { code: "XX000", message: "boom" } } });
    await remove(valid);
    const logged = inspect(logError.mock.calls, { depth: null });
    expect(logged).not.toContain(user.email);
    expect(logged).not.toContain(user.id);
  });
});
