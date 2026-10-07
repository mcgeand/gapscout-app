/**
 * The name parse behind migration v6 (#263).
 *
 * This is the half of the migration that decides what a user's project is
 * called afterwards, so the cases that matter are the ones where it should do
 * nothing: a name that merely contains the word "state", and a name that is
 * the phrase and nothing else.
 */

import { describe, expect, it } from "vitest";
import { isProjectState, parseProjectName } from "../lib/projectState";

describe("parseProjectName", () => {
  it("lifts a trailing Current State into the field and trims the separator", () => {
    expect(parseProjectName("P2P - Acme Corp Current State")).toEqual({
      state: "current",
      name: "P2P - Acme Corp",
      renamed: true,
    });
  });

  it("lifts a trailing future state past an em dash", () => {
    expect(parseProjectName("Order to Cash — future state")).toEqual({
      state: "future",
      name: "Order to Cash",
      renamed: true,
    });
  });

  it("maps as-is to current and to-be to future", () => {
    expect(parseProjectName("Invoicing as-is state").state).toBe("current");
    expect(parseProjectName("Invoicing as is state").state).toBe("current");
    expect(parseProjectName("Invoicing to-be state").state).toBe("future");
    expect(parseProjectName("Invoicing to be state").state).toBe("future");
  });

  it("trims a separator the strip leaves at the front, not only the end", () => {
    expect(parseProjectName("Current State: Order to Cash")).toEqual({
      state: "current",
      name: "Order to Cash",
      renamed: true,
    });
  });

  it("collapses the separators a mid-name strip leaves adjacent", () => {
    expect(parseProjectName("Q1 - Current State - Acme")).toEqual({
      state: "current",
      name: "Q1 - Acme",
      renamed: true,
    });
  });

  it("trims an en dash, which is what macOS substitutes for a typed hyphen", () => {
    expect(parseProjectName("Order to Cash \u2013 future state")).toEqual({
      state: "future",
      name: "Order to Cash",
      renamed: true,
    });
    expect(parseProjectName("Order to Cash \u2013 Current State \u2013 v2")).toEqual({
      state: "current",
      name: "Order to Cash \u2013 v2",
      renamed: true,
    });
  });

  it("removes a bracket pair the phrase was the whole of", () => {
    expect(parseProjectName("P2P - Acme Corp (Current State)")).toEqual({
      state: "current",
      name: "P2P - Acme Corp",
      renamed: true,
    });
    expect(parseProjectName("P2P - Acme Corp [future state]")).toEqual({
      state: "future",
      name: "P2P - Acme Corp",
      renamed: true,
    });
  });

  it("keeps a bracketed qualifier that was not the phrase", () => {
    expect(parseProjectName("Acme (legacy) Current State")).toEqual({
      state: "current",
      name: "Acme (legacy)",
      renamed: true,
    });
  });

  it("leaves a name that merely contains the word state alone", () => {
    for (const name of [
      "Real Estate Onboarding",
      "State of the Union",
      "Gas is stateless",
      "How to be stateful",
      "my process",
    ]) {
      expect(parseProjectName(name)).toEqual({ name, renamed: false });
    }
  });

  it("classifies a name that is only the phrase but does not blank it", () => {
    // Stripping would leave "", which fails ProjectSchema's min(1) on read.
    expect(parseProjectName("Current State")).toEqual({
      state: "current",
      name: "Current State",
      renamed: false,
    });
  });

  it("matches with no space between the keyword and state", () => {
    // `\s*` in the spec's regex, pinned so a later tightening is a decision.
    expect(parseProjectName("Billing currentstate")).toEqual({
      state: "current",
      name: "Billing",
      renamed: true,
    });
  });

  it("is idempotent — a parsed name parses to itself", () => {
    const once = parseProjectName("P2P - Acme Corp Current State");
    expect(parseProjectName(once.name)).toEqual({ name: once.name, renamed: false });
  });
});

describe("isProjectState", () => {
  it("accepts only the two states", () => {
    expect(isProjectState("current")).toBe(true);
    expect(isProjectState("future")).toBe(true);
    for (const value of [null, undefined, "", "Current", "archived", 1]) {
      expect(isProjectState(value)).toBe(false);
    }
  });
});
