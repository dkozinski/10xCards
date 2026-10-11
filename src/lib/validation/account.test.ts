import { describe, expect, it } from "vitest";
import { deleteAccountSchema, emailsMatch } from "./account";

describe("emailsMatch", () => {
  it("matches the same address", () => {
    expect(emailsMatch("dawid@example.com", "dawid@example.com")).toBe(true);
  });

  it("ignores surrounding whitespace and case", () => {
    expect(emailsMatch(" Dawid@Example.com ", "dawid@example.com")).toBe(true);
  });

  it("rejects a different address", () => {
    expect(emailsMatch("other@example.com", "dawid@example.com")).toBe(false);
  });

  it("rejects an empty typed value", () => {
    expect(emailsMatch("   ", "dawid@example.com")).toBe(false);
  });

  it("rejects when the account has no email", () => {
    expect(emailsMatch("", "")).toBe(false);
    expect(emailsMatch("dawid@example.com", "")).toBe(false);
  });
});

describe("deleteAccountSchema", () => {
  it("accepts a confirmation string", () => {
    expect(deleteAccountSchema.safeParse({ confirm_email: "dawid@example.com" }).success).toBe(true);
  });

  it("rejects a missing, empty or oversized confirmation", () => {
    expect(deleteAccountSchema.safeParse({}).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ confirm_email: "" }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ confirm_email: "a".repeat(321) }).success).toBe(false);
  });
});
