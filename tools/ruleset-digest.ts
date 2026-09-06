/**
 * The hash that makes "same ruleset version" a checkable claim (spec v0.2 §41).
 *
 * `RULESET_VERSION` is displayed to the reader next to their reflection, and a version string is
 * only worth displaying if it cannot silently stop being true. `test/digest.test.ts` recomputes
 * this over the live values and compares it to `src/ruleset.digest.json`, so a threshold cannot
 * move, a rule cannot be reworded, and a confidence ceiling cannot be raised without either the
 * test failing or someone bumping the version and regenerating the file on purpose.
 *
 * What is hashed is the whole rule table, not only the numbers. The sentence a rule puts in front
 * of a reader, the alternatives it offers them, and the distortion it admits to are all part of
 * what the ruleset *is*; a version that covered the thresholds but not the wording would let the
 * claims change while reporting that they had not.
 */

import { createHash } from "node:crypto";
import { inferenceRules } from "../src/claims";
import { THRESHOLDS } from "../src/thresholds";
import { canonicalJson, type Canonical } from "./canonical-json";

export function rulesetInput(): Canonical {
  return {
    thresholds: THRESHOLDS as unknown as Canonical,
    rules: inferenceRules as unknown as Canonical,
  };
}

export function rulesetDigest(): string {
  return createHash("sha256").update(canonicalJson(rulesetInput()), "utf8").digest("hex");
}
