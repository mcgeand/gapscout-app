/**
 * Whether a project maps the process as it runs today or as it is meant to
 * run. Until #263 this lived inside `projects.name` as a phrase —
 * `P2P - Acme Corp Current State` — which is why the name outgrew the header
 * (#264) and why nothing could filter or pair on state.
 *
 * The parse here is used once, by migration v6, to lift that phrase out of
 * every legacy name. It is a pure function so the awkward parts — a name that
 * merely contains the word "state", a strip that leaves a dangling separator,
 * a name that is *only* the phrase — are testable without a database.
 */

import type { ProjectState } from "../data/types";

export type { ProjectState };

/** `state` is nullable on purpose: NULL means nobody has said. */
export function isProjectState(value: unknown): value is ProjectState {
  return value === "current" || value === "future";
}

/**
 * The phrase a legacy name carries. `\s*` rather than `\s+` matches the
 * issue's spec, so `currentstate` is a hit too; a name has to contain one of
 * the four keywords immediately before "state" to match at all.
 */
const STATE_PHRASE = /\b(current|future|as[- ]?is|to[- ]?be)\s*state\b/i;

/**
 * Separators left stranded once the phrase is cut off an end. U+2013 en dash
 * is in here as well as U+2014 em dash because macOS and Word both substitute
 * it for a typed ` - `, so it reaches us far more often than it is typed.
 */
const EDGE_SEPARATORS = /^[\s\-–—·:]+|[\s\-–—·:]+$/g;

/**
 * Separators left adjacent once the phrase is cut out of the middle:
 * `Q1 - Current State - Acme` would otherwise come out as `Q1 - - Acme`.
 */
const DOUBLED_SEPARATORS = /([-–—·:])\s*(?:[-–—·:]\s*)+/g;

/**
 * A bracket pair the phrase was the whole of: `Acme (Current State)` must not
 * come out as `Acme ( )`. Only ever applied on the hit path.
 */
const EMPTY_BRACKETS = /[([]\s*[)\]]/g;

export interface ParsedProjectName {
  /** The state the name declared, or `undefined` when it declared none. */
  state?: ProjectState;
  /**
   * The name with the phrase removed, or the original name when there was no
   * phrase — or when removing it would leave nothing at all.
   */
  name: string;
  /**
   * True only when `name` actually differs from the input, which is what
   * makes the rename reversible and what the migration keys `legacy_name` on.
   * A project named exactly `Current State` gets a state but keeps its name,
   * so there is nothing to revert and nothing to record.
   */
  renamed: boolean;
}

function toState(keyword: string): ProjectState {
  const normalized = keyword.toLowerCase().replace(/[-\s]/g, "");
  return normalized === "current" || normalized === "asis" ? "current" : "future";
}

/**
 * Lift a state phrase out of a project name.
 *
 * A miss changes nothing: `my process` and `Real Estate Onboarding` come back
 * byte-identical with no state, because the migration must leave every name it
 * does not recognise alone.
 */
export function parseProjectName(name: string): ParsedProjectName {
  const match = STATE_PHRASE.exec(name);
  if (!match) return { name, renamed: false };

  const state = toState(match[1]);

  // Collapse the whitespace the cut leaves behind before trimming the edges,
  // or `P2P - Current State - Acme` would keep its doubled separator.
  const stripped = name
    .replace(STATE_PHRASE, " ")
    .replace(EMPTY_BRACKETS, "")
    .replace(/\s+/g, " ")
    .replace(DOUBLED_SEPARATORS, "$1 ")
    .replace(EDGE_SEPARATORS, "");

  // `Current State` strips to nothing. Keep the name it has — a project with
  // an empty name fails `ProjectSchema` on every read.
  if (stripped.length === 0) return { state, name, renamed: false };

  return { state, name: stripped, renamed: stripped !== name };
}
