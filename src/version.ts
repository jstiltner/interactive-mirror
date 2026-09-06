/**
 * What the deployed mirror is (spec v0.2 §41, §46).
 *
 * A reader looking at a claim on a live page needs to be able to get from that claim to the exact
 * source that produced it. Four identifiers make that walk possible, and they are split across two
 * repositories on purpose:
 *
 *   - `PACKAGE_VERSION`   — this package's release.
 *   - `RULESET_VERSION`   — the thresholds and rule table. Changes when behaviour changes.
 *   - `PASSAGE_MANIFEST_VERSION` (in `manifest.ts`) — the authorial classification of the prose.
 *   - the commit SHA — supplied by the *host application*, from its own lockfile.
 *
 * The SHA is not here, and cannot be. A file inside a commit cannot contain the hash of the commit
 * that contains it. The host reads it from `package-lock.json`, where npm has already recorded the
 * resolved revision, and passes it in as `MirrorBuildIdentity` (see `identity.ts`). That makes it
 * an observation about the deployed artifact rather than an assertion by the artifact about itself.
 */

export const PACKAGE_VERSION = "0.2.1";

/**
 * Bumped whenever `thresholds.ts` or the rule table in `claims.ts` changes. `ruleset.digest.json`
 * is the enforcement: the digest test fails if the values moved and this string did not, so
 * "same ruleset version" is a checkable claim rather than a habit.
 */
export const RULESET_VERSION = "2026-09-05.1";
