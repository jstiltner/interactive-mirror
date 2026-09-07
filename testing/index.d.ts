/**
 * Types for the DOM contract in `index.js`.
 *
 * Hand-written and hand-maintained, not generated — see the header of `index.js` for why this
 * module is the one place in the package where the values and their types live in separate
 * files. `test/dom-contract.test.ts` imports both and checks they still agree, so the split
 * cannot drift silently.
 */

export declare const MIRROR_SELECTORS: {
  /** The panel root. Present in the inert server-rendered shell as well. */
  readonly root: "[data-mirror-root]";
  /** §31's state machine, stamped into the DOM. */
  readonly state: "[data-mirror-state]";
  /** The one control that can cross the exposure boundary (§38). */
  readonly reveal: "[data-mirror-reveal]";
  /** An exposed claim, carrying its rule, its id and its confidence tier. */
  readonly claim: "[data-mirror-claim]";
  /** Accurate / Wrong / More complicated (§17). */
  readonly response: "[data-mirror-response]";
  /** The "What this was derived from" contents, once opened. */
  readonly claimDetail: "[data-mirror-claim] [data-source-link]";
  /** A rule in the plain-language disclosure (§41). */
  readonly rule: "[data-mirror-rule]";
  readonly rulesToggle: "[data-mirror-rules-toggle]";
  /** A commit-pinned link from a rule id to the lines that implement it (§41). */
  readonly sourceLink: "[data-source-link]";
  /** The §39 partition, rendered separately and feeding nothing. */
  readonly postExposure: "[data-mirror-post-exposure]";
  /** The always-visible build line: package, ruleset, manifest, commit. */
  readonly buildIdentity: "[data-mirror-build-identity]";
  readonly identityDetail: "[data-mirror-identity-detail]";
};

export declare function claimSelector(claimId: string): string;
export declare function ruleSelector(ruleId: string): string;
export declare function sourceLinkSelector(ruleId: string): string;

/**
 * The fields of an exposed claim that must be byte-identical before and after any post-exposure
 * reading (§18). Deliberately *not* the whole element: the response history below a claim is
 * expected to grow when the reader presses a button, and asserting on the full subtree would
 * either fail on that or force the test to allow edits it should be forbidding.
 */
export interface ClaimFingerprint {
  claimId: string;
  ruleId: string;
  confidence: string;
  statement: string;
}

/**
 * The storage surfaces a session-only, request-free mirror must leave empty (§45).
 *
 * Read as a list of *capabilities*, not of settings. The package is expected to contain no code
 * that could write to any of these, which is why the guard is an AST scan and this list is only
 * the runtime confirmation of it.
 */
export declare const FORBIDDEN_STORAGE: readonly [
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "cookie",
];
