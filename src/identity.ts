/**
 * What the deployed mirror is, and how a reader walks from a claim to the source (spec v0.2 §41).
 *
 * Three of the four identifiers are inside this package and can be imported. The fourth — the
 * commit — cannot be, and the reason is not a limitation to work around. A file inside a commit
 * cannot contain the hash of the commit that contains it: writing the SHA into the source changes
 * the source, which changes the SHA. Any package that appears to know its own revision is either
 * reading it back from a build step or reporting a stale one.
 *
 * So the host supplies it. The host has already resolved this package to an exact revision in its
 * lockfile; reading it from there and passing it in makes the SHA an *observation about the
 * deployed artifact* rather than an assertion the artifact makes about itself. It is a required
 * prop, so a host that forgets fails `tsc` rather than shipping a panel whose audit links point
 * nowhere.
 *
 * Caveat worth stating plainly, because the panel is about not overclaiming: npm records no
 * content hash for git dependencies — it deletes `integrity` for them by design. The lockfile
 * pins a commit, which is a strong guarantee about *which* tree was installed, and no guarantee
 * at all that the tree was not tampered with in transit. This is a pinned reference, not SRI.
 */

import { SOURCE_SPANS } from "./generated/source-spans";
import { PASSAGE_MANIFEST_VERSION } from "./manifest";
import { PACKAGE_VERSION, RULESET_VERSION } from "./version";

export interface MirrorBuildIdentity {
  /** `owner/name` on GitHub. */
  repository: string;
  /** The full 40-character revision this build installed, from the host's lockfile. */
  commit: string;
}

export interface MirrorIdentity extends MirrorBuildIdentity {
  packageVersion: string;
  rulesetVersion: string;
  manifestVersion: string;
  shortCommit: string;
  treeUrl: string;
}

export function describeIdentity(build: MirrorBuildIdentity): MirrorIdentity {
  return {
    ...build,
    packageVersion: PACKAGE_VERSION,
    rulesetVersion: RULESET_VERSION,
    manifestVersion: PASSAGE_MANIFEST_VERSION,
    shortCommit: build.commit.slice(0, 7),
    treeUrl: `https://github.com/${build.repository}/tree/${build.commit}`,
  };
}

/**
 * The link that closes the chain: reader behaviour → observation → claim → rule id → these exact
 * lines, at the revision actually deployed. Returns undefined rather than a file-level fallback —
 * a link that lands on a four-hundred-line file and leaves the reader to find the rule is not
 * evidence, and offering one would misrepresent how much has been shown.
 */
export function ruleSourceUrl(
  build: MirrorBuildIdentity,
  ruleId: string
): string | undefined {
  const span = SOURCE_SPANS[ruleId];
  if (!span) return undefined;
  return `https://github.com/${build.repository}/blob/${build.commit}/${span.file}#L${span.startLine}-L${span.endLine}`;
}
