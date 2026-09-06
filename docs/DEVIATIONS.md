# Deviations from the specification

Every place this implementation departs from [`spec-v0.2.md`](spec-v0.2.md), with the reasoning. Nothing here was changed silently; the point of the file is that a reader can check the implementation against the spec and know in advance which mismatches are decisions and which would be bugs.

---

## 1. A note on which file is the spec

Two files circulated under v0.2 names. The one named `interactive-mirror-spec-v0.2.md` contains **v0.1** — 29 sections, no §4, no §19a. The authoritative document is the 50-section version, committed here as [`spec-v0.2.md`](spec-v0.2.md) verbatim. Every `§` reference in the source comments and in the README is to that file.

This matters because the two differ on things that are load-bearing. §19a (the physical pre/post partition) and §4 exist only in the real v0.2, and an implementation checked against the wrong file would have been checked against a specification that never asked for them.

---

## 2. §21 / §44 — mobile measurement was broken. Fixed.

**Status: defect found in the pre-extraction implementation, fixed here.**

The original visibility test was a single fixed `IntersectionObserver` threshold of `0.35`, with observer options `{ threshold: [0, 0.35, 1] }`.

`intersectionRatio` is the fraction of *the element* that is visible, and is therefore capped at `viewportHeight / elementHeight`. Every numbered section of the essay is between 1386px and 2136px tall. At a 400px viewport the maximum achievable ratio is 0.19–0.29 — below the threshold, for every section, unconditionally. Only the `abstract` block (492px) could ever register. Worse, because 0.35 was never crossed, the callback did not fire at all for those elements.

Empirically the panel reported "1 section measured" on a phone, and the reader had no way to tell that from a reader who had genuinely read one section.

**Fix:** the meaningful-visibility test is now two clauses — an element counts as being read if a sufficient fraction of *the element* is visible **or** a sufficient fraction of *the viewport* is filled by it. The observer is given a graduated threshold array rather than three values, so the callback fires as a tall element scrolls through.

This is the deviation most worth stating plainly: for the entire pre-extraction life of the artifact, the Mirror measured phone readers wrongly and said nothing about it. A panel whose subject is honest measurement had a measurement bug it could not detect.

---

## 3. §41 — source links were claimed but not supplied. Closed.

The original `MirrorShell` told the reader the rules were "in the page source" and gave no URL. That is the weakest possible form of the §41 promise: technically true, useless as evidence, and unfalsifiable by the reader it is addressed to.

**Closed by the build-identity work.** The deployed panel now shows package version, ruleset version, manifest version and short commit, and every rule links to its own line range at the exact deployed revision. See the README's build-identity section for the mechanism, and for why the commit SHA is a required prop from the host rather than a constant in this package.

Related design note, recorded because it is a place where a weaker link was available and rejected: `ruleSourceUrl` returns `undefined` when no span is known, rather than degrading to a file-level link. A link that lands on a four-hundred-line file is not evidence for a specific rule, and offering one would overstate how much has been shown.

---

## 4. `InferenceRule.maximumConfidence` — a spec-level change, applied and flagged

**This is a change to the spec's data model, not merely to the implementation. It is called out here rather than absorbed.**

The spec's rule shape carries a single field, `maximumConfidence: Confidence | "observation"`, where `"observation"` means "this rule may never become a claim at all" — §32's treatment of nonlinear reading.

`Confidence` is ordinal and two-valued by design (§13, §36). A union that also carries "not a claim" is not an ordinal scale; it is a scale with an escape hatch, and every consumer downstream has to remember that the ceiling might not be a confidence level. That is precisely the kind of quiet widening §13 exists to prevent, and it would have defeated the `@ts-expect-error` compile-time guard on the union.

**Applied:** split into two fields.

```ts
promotable: boolean;          // may this rule become a claim at all?
maximumConfidence: Confidence; // if it does, how far can it go?
```

`nonlinear_reader_v1` is `{ promotable: false, maximumConfidence: "low" }`. `deriveClaims` skips non-promotable rules before doing any other work. The only values that can reach a reader remain `"low"` and `"moderate"`.

The behaviour is identical to the spec's. The type is not, and someone reading the spec alongside the source should know why.

---

## 5. `ReaderEventType` includes `"activity"`, which §30 does not list

**Deliberate, and required by two other sections.**

§6 makes dwell conditional on recent interaction: a page left open in front of an absent reader must not accrue attention. §35 requires derivation to be a pure function of the event log — an identical history must produce identical observations.

Those two together force the activity signal into the log. If "was the reader recently active" were answered by a live timer or a ref outside the event array, the same log would derive different observations depending on when it was replayed, and §35 would be false. So the session store emits a throttled `activity` ping (every 5s, coalesced) and `activeIntervals` reconstructs the §6 window from those pings.

The cost is honest: the log is larger, and one event type exists for the measurement apparatus rather than for the reader. The alternative was a purity claim that was not true. This is documented in `src/types.ts` as well as here.

---

## 6. Guard A: the `@types/node` finding

Not a deviation from the spec, but a finding about the *verification* the spec's privacy sections rest on, and it belongs in the record.

Guard A resolves every identifier through the TypeScript type checker and reports any global not on a closed allowlist. Its test for "is this an ambient global" was originally "are all of this symbol's declarations in a `lib.*.d.ts` file". `@types/node` (via `undici-types`) re-declares `fetch`, `localStorage` and `navigator` as globals alongside `lib.dom.d.ts`. For those three symbols the test returned false, so they were never checked — the exact three capabilities the guard exists to forbid.

The guard passed. It passed for the same reason a scanner that resolves nothing passes: **a closed allowlist fails open, and a guard that finds nothing is indistinguishable from a guard that cannot find anything.**

Two changes followed. The ambient test is now inverted — a symbol is ambient if *no* declaration lives inside `src/` — and, more importantly, `fixtures/capability-probe/` was added: a file that reaches for every disclaimed capability, scanned by the same function, with a test asserting the exact violation set per line. The probe ships in the published tarball, listed in `package-contents.json`, as a reviewed decision rather than an accident.

---

## 7. Scope of the privacy claim

The spec's privacy sections are written about the Mirror. The essay page around it is a different artifact with different code, and this repository can say nothing about it.

Stated here so the distinction is not lost in the move to a public repo, where the README is the only thing most readers will see: **"the Mirror sends nothing" is the claim these guards support. "The page sends nothing anywhere" is not, and must not be implied.** Whole-page verification against a production build lives in the host repository.

---

## 8. Git dependency integrity

The consumption model is a git-pinned npm dependency. npm deletes the `integrity` field for git dependencies by design; the lockfile records a resolved commit and no content hash.

That is a strong guarantee about *which* tree was installed and no guarantee that the tree was not tampered with in transit. The build-identity panel must not be read as claiming subresource-integrity-grade verification, and `src/identity.ts` says so in the file that produces the links.
