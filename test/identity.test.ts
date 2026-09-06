/**
 * The generated artifacts, kept honest (spec v0.2 §41).
 *
 * `RULESET_VERSION` and the per-rule source links are shown to a reader as facts about the build
 * that just described them. Both are derived from source that can change independently of the
 * strings that report it, so both need a test that fails when they drift apart. That is the whole
 * content of §41's "the reader can check this": not that the link exists, but that nobody can
 * quietly make it wrong.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inferenceRules } from "../src/claims";
import { SOURCE_SPANS } from "../src/generated/source-spans";
import { describeIdentity, ruleSourceUrl } from "../src/identity";
import { PASSAGE_MANIFEST_VERSION } from "../src/manifest";
import { PACKAGE_VERSION, RULESET_VERSION } from "../src/version";
import { computeSourceSpans, renderSourceSpans } from "../tools/source-spans";
import { rulesetDigest } from "../tools/ruleset-digest";

const root = path.join(__dirname, "..");

const identity = {
  repository: "jstiltner/interactive-mirror",
  commit: "0123456789abcdef0123456789abcdef01234567",
};

describe("ruleset digest", () => {
  it("matches the committed digest", () => {
    const committed = JSON.parse(readFileSync(path.join(root, "src/ruleset.digest.json"), "utf8"));
    expect(committed.digest).toBe(rulesetDigest());
  });

  it("is recorded against the ruleset version the panel displays", () => {
    const committed = JSON.parse(readFileSync(path.join(root, "src/ruleset.digest.json"), "utf8"));
    // Without this, the digest could be regenerated after a threshold change while the version
    // string stayed put — and the version string is the part a reader is actually shown.
    expect(committed.rulesetVersion).toBe(RULESET_VERSION);
  });
});

describe("source spans", () => {
  it("regenerates identically from the current source", () => {
    expect(computeSourceSpans(root)).toEqual(SOURCE_SPANS);
  });

  it("matches the committed generated file byte for byte", () => {
    const committed = readFileSync(path.join(root, "src/generated/source-spans.ts"), "utf8");
    expect(renderSourceSpans(computeSourceSpans(root))).toBe(committed.replace(/\r\n/g, "\n"));
  });

  it("covers every inference rule", () => {
    for (const rule of inferenceRules) {
      expect(SOURCE_SPANS[rule.id], rule.id).toBeDefined();
    }
  });

  it("gives every rule a distinct span", () => {
    const keys = Object.values(SOURCE_SPANS).map(
      (span) => `${span.file}:${span.startLine}-${span.endLine}`
    );
    // Two rules sharing a span would mean a reader auditing one is silently handed another.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("points at spans that exist in the files they name", () => {
    for (const [ruleId, span] of Object.entries(SOURCE_SPANS)) {
      const lines = readFileSync(path.join(root, span.file), "utf8").split(/\r?\n/);
      expect(span.startLine, ruleId).toBeGreaterThan(0);
      expect(span.endLine, ruleId).toBeLessThanOrEqual(lines.length);
      expect(span.endLine, ruleId).toBeGreaterThanOrEqual(span.startLine);
      // The rule id must actually appear inside the lines the link will highlight, or the link
      // is pointing a reader at code that has nothing to do with the claim they asked about.
      const body = lines.slice(span.startLine - 1, span.endLine).join("\n");
      expect(body, ruleId).toContain(ruleId);
    }
  });
});

describe("build identity", () => {
  it("reports all four identifiers, three from here and the commit from the host", () => {
    const described = describeIdentity(identity);
    expect(described.packageVersion).toBe(PACKAGE_VERSION);
    expect(described.rulesetVersion).toBe(RULESET_VERSION);
    expect(described.manifestVersion).toBe(PASSAGE_MANIFEST_VERSION);
    expect(described.commit).toBe(identity.commit);
    expect(described.shortCommit).toBe("0123456");
  });

  it("builds a commit-pinned line-anchored url for a known rule", () => {
    const span = SOURCE_SPANS.mechanism_affinity_v1;
    expect(ruleSourceUrl(identity, "mechanism_affinity_v1")).toBe(
      `https://github.com/jstiltner/interactive-mirror/blob/${identity.commit}/${span.file}#L${span.startLine}-L${span.endLine}`
    );
  });

  it("returns nothing rather than a file-level guess for an unknown rule", () => {
    expect(ruleSourceUrl(identity, "not_a_rule_v1")).toBeUndefined();
  });

  it("never links to a mutable ref", () => {
    for (const ruleId of Object.keys(SOURCE_SPANS)) {
      const url = ruleSourceUrl(identity, ruleId);
      // A link to /blob/main would show the reader whatever the rule says today, not the rule
      // that produced the claim in front of them.
      expect(url).toContain(`/blob/${identity.commit}/`);
      expect(url).not.toContain("/blob/main/");
    }
  });
});
