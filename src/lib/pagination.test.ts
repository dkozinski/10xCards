import { describe, expect, it } from "vitest";
import { MAX_PAGE, PAGE_SIZE, pageWindow, parsePage } from "./pagination";

describe("parsePage", () => {
  it.each([
    [null, 1],
    ["", 1],
    ["0", 1],
    ["-3", 1],
    ["abc", 1],
    ["1.5", 1],
    ["2", 2],
    [String(MAX_PAGE), MAX_PAGE],
    [String(MAX_PAGE + 1), 1],
    ["9007199254740993", 1],
    ["99999999999999999999", 1],
  ])("parses %j as %i", (raw, expected) => {
    expect(parsePage(raw)).toBe(expected);
  });
});

describe("pageWindow", () => {
  it("treats an empty deck as a single page", () => {
    expect(pageWindow(1, 0)).toEqual({ from: 0, to: 49, lastPage: 1, hasNewer: false, hasOlder: false });
  });

  it("fits exactly one full page on one page", () => {
    expect(pageWindow(1, PAGE_SIZE)).toMatchObject({ lastPage: 1, hasOlder: false });
  });

  it("spills card 51 onto a second page", () => {
    expect(pageWindow(1, 51)).toMatchObject({ from: 0, to: 49, lastPage: 2, hasNewer: false, hasOlder: true });
    expect(pageWindow(2, 51)).toEqual({ from: 50, to: 99, lastPage: 2, hasNewer: true, hasOlder: false });
  });
});
