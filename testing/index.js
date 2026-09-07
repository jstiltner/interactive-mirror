/**
 * The DOM contract, exported so consumers do not hand-roll selectors (spec v0.2 §41, §45).
 *
 * The portfolio verifies the Mirror's invariants against a *production* build, because a claim
 * that only holds in development is not a claim about what readers get. That rules out most ways
 * of finding things in the page: SWC mangles function names, CSS-in-JS rewrites class names, and
 * React component identity does not survive to the browser at all. `data-*` attribute names are
 * string literals in the emitted JSX, so they come through the minifier unchanged.
 *
 * Exporting them from the package rather than duplicating them in the consumer's test suite is
 * the point. If a selector here stops matching, the package's own tests break in the same commit
 * as the consumer's — instead of the consumer's suite quietly passing against nothing, which is
 * how "no Mirror-originated request was observed" turns into a sentence that is true because
 * nothing was looked at.
 *
 * ## Why this one module is JavaScript when the rest of the package is TypeScript
 *
 * Everything else here ships as `.ts` on purpose: a reader auditing the deployed Mirror should be
 * reading the same characters the browser ran, and the host application's bundler compiles them.
 * This module has a different job. It is loaded by *other people's test runners*, and a test
 * runner is not a bundler.
 *
 * Playwright is the concrete case. It transpiles the files under its own `testDir` and delegates
 * everything else to Node, and Node refuses to strip types from anything inside `node_modules` —
 * unconditionally, with no flag. Playwright's exclusion is equally hardcoded. So a `.ts` file
 * here is unloadable by the single most likely consumer of a DOM contract, and the failure looks
 * like a broken package rather than a policy.
 *
 * Hand-written `.js` plus a hand-written `.d.ts` keeps the package's actual principle intact —
 * nothing is compiled, what you read is what runs — while making the contract loadable by any
 * runner. The types are maintained beside the values in `index.d.ts`; there is no build step and
 * no generated artifact.
 */

export const MIRROR_SELECTORS = {
  /** The panel root. Present in the inert server-rendered shell as well. */
  root: "[data-mirror-root]",
  /** §31's state machine, stamped into the DOM: loading | collecting | ready | exposed | insufficient | post_exposure. */
  state: "[data-mirror-state]",
  /** The one control that can cross the exposure boundary (§38). */
  reveal: "[data-mirror-reveal]",
  /** An exposed claim, carrying its rule, its id and its confidence tier. */
  claim: "[data-mirror-claim]",
  /** Accurate / Wrong / More complicated (§17). */
  response: "[data-mirror-response]",
  /** The "What this was derived from" contents, once opened. */
  claimDetail: "[data-mirror-claim] [data-source-link]",
  /** A rule in the plain-language disclosure (§41). */
  rule: "[data-mirror-rule]",
  rulesToggle: "[data-mirror-rules-toggle]",
  /** A commit-pinned link from a rule id to the lines that implement it (§41). */
  sourceLink: "[data-source-link]",
  /** The §39 partition, rendered separately and feeding nothing. */
  postExposure: "[data-mirror-post-exposure]",
  /** The always-visible build line: package, ruleset, manifest, commit. */
  buildIdentity: "[data-mirror-build-identity]",
  identityDetail: "[data-mirror-identity-detail]",
};

/**
 * @param {string} claimId
 * @returns {string}
 */
export function claimSelector(claimId) {
  return `[data-mirror-claim][data-claim-id="${claimId}"]`;
}

/**
 * @param {string} ruleId
 * @returns {string}
 */
export function ruleSelector(ruleId) {
  return `[data-mirror-rule][data-rule-id="${ruleId}"]`;
}

/**
 * @param {string} ruleId
 * @returns {string}
 */
export function sourceLinkSelector(ruleId) {
  return `[data-source-link][data-rule-id="${ruleId}"]`;
}

/**
 * The storage surfaces a session-only, request-free mirror must leave empty (§45).
 *
 * Read as a list of *capabilities*, not of settings. The package is expected to contain no code
 * that could write to any of these, which is why the guard is an AST scan and this list is only
 * the runtime confirmation of it.
 */
export const FORBIDDEN_STORAGE = ["localStorage", "sessionStorage", "indexedDB", "cookie"];
