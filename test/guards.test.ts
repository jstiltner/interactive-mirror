/**
 * Structural absence (spec v0.2 §45, and the brief's "prefer structural absence to a runtime
 * flag").
 *
 * These are the tests behind the sentence the panel shows every reader: none of it leaves your
 * browser, nothing is stored, it is gone when you reload. Each guard establishes that a *class*
 * of behaviour is impossible rather than currently switched off.
 *
 * What they do not establish, and the README says so too: the host page around the Mirror is a
 * separate question. These tests are about this package. Whether the whole essay page is silent
 * is verified in the portfolio, against a production build, because only there does the question
 * have a whole page to ask it about.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanForCapabilities } from "../tools/guard-structural-absence";

const root = path.join(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

describe("guard A — the capability is absent, not disabled", () => {
  it("resolves no global outside the allowlist and no forbidden member anywhere", () => {
    const violations = scanForCapabilities(root);
    // Printed in full rather than counted: a failure here should tell you which line reached for
    // what, not merely that something did.
    expect(violations.map((v) => `${v.file}:${v.line} ${v.message}`)).toEqual([]);
  });

  // The test above passes when the guard works and also when the guard is broken, because a
  // scanner that resolves nothing reports nothing. `fixtures/capability-probe/` is the control:
  // a file that reaches for every capability the package disclaims, scanned by the same function.
  // Its header records the specific bug that made this necessary.
  it("catches every capability in the probe fixture", () => {
    const probe = path.join(root, "fixtures/capability-probe");
    const caught = new Set(scanForCapabilities(probe).map((v) => v.message));
    for (const message of [
      "global 'fetch' is not on the allowlist",
      "global 'localStorage' is not on the allowlist",
      "global 'navigator' is not on the allowlist",
      "global 'WebSocket' is not on the allowlist",
      "forbidden member access .setItem",
      "forbidden member access .sendBeacon",
      "forbidden member access .cookie",
      'forbidden member access ["fetch"]',
      "document.cookie is not on the document allowlist",
      "computed member access on window",
      "forbidden reference to WebSocket",
      "forbidden reference to Function",
    ]) {
      expect(caught, message).toContain(message);
    }
  });

  it("catches each of the probe's statements, and catches most of them twice", () => {
    const probe = path.join(root, "fixtures/capability-probe");
    const violations = scanForCapabilities(probe);
    const byLine = new Map<number, string[]>();
    for (const violation of violations) {
      byLine.set(violation.line, [...(byLine.get(violation.line) ?? []), violation.message]);
    }
    // Every statement in the fixture is a capability, so every statement line must appear. The
    // second column is the redundancy: where two independent rules catch the same line, one of
    // them can break without the file going quiet, and this records which lines have that
    // property and which rest on a single rule.
    expect(Object.fromEntries([...byLine].sort((a, b) => a[0] - b[0]))).toEqual({
      22: ["global 'fetch' is not on the allowlist"],
      25: ["forbidden member access .setItem", "global 'localStorage' is not on the allowlist"],
      28: ["computed member access on window", 'forbidden member access ["fetch"]'],
      31: ["computed member access on window"],
      34: ["forbidden member access .sendBeacon", "global 'navigator' is not on the allowlist"],
      37: ["forbidden member access .cookie", "document.cookie is not on the document allowlist"],
      40: ["forbidden reference to WebSocket", "global 'WebSocket' is not on the allowlist"],
      43: ["forbidden reference to Function", "global 'Function' is not on the allowlist"],
      46: ["global 'navigator' is not on the allowlist"],
    });
  });
});

describe("guard B — nothing can arrive through the dependency graph", () => {
  it("declares no runtime dependencies", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("peers on react and nothing else", () => {
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual(["react"]);
  });

  it("runs no lifecycle scripts on install", () => {
    // A `prepare` script is not a style preference. npm runs it inside the git checkout of a git
    // dependency, which would mean a full `npm install` executing on the deploy host at install
    // time — arbitrary code, on the server, from a tree nobody reviewed at that moment.
    for (const hook of ["prepare", "preinstall", "install", "postinstall"]) {
      expect(pkg.scripts?.[hook], hook).toBeUndefined();
    }
  });

  it("imports only relative paths and react from src", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = readFileSync(full, "utf8");
          for (const match of text.matchAll(/^\s*(?:import|export)[^'"]*from\s*["']([^"']+)["']/gm)) {
            const specifier = match[1];
            const permitted =
              specifier.startsWith(".") || specifier === "react" || specifier === "react/jsx-runtime";
            if (!permitted) offenders.push(`${path.relative(root, full)} -> ${specifier}`);
          }
        }
      }
    };
    walk(path.join(root, "src"));
    expect(offenders).toEqual([]);
  });

  it("reaches for no node builtin from src", () => {
    // `src/` runs in a browser. A `node:` import would mean either dead code or a module that
    // only works in the tests that were meant to be checking it.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && /["']node:/.test(readFileSync(full, "utf8"))) {
          offenders.push(path.relative(root, full));
        }
      }
    };
    walk(path.join(root, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("guard C — what actually ships", () => {
  it("publishes the source, the tools, the fixtures and the licence, and nothing else", () => {
    expect(pkg.files).toEqual(["src", "tools", "testing", "fixtures", "README.md", "LICENSE"]);
  });

  it("exports the source directly, with no build step to hide anything in", () => {
    // A source-only package is the point. A reader auditing the deployed Mirror is reading the
    // same characters the browser ran, not a bundle they have to trust was built from them.
    expect(pkg.exports["."]).toBe("./src/index.ts");
    expect(pkg.main).toBeUndefined();
    expect(pkg.module).toBeUndefined();
  });
});
