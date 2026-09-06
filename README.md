# Interactive Mirror

A reader model that shows its work.

This is the instrument from Section VIII of the essay [*The Archive That Cites Itself*](https://jasonstiltner.com/writing/archive-that-cites-itself/). While you read the essay it watches how you read it, and when — and only when — you ask it to, it tells you what it thinks it saw, how confident it is, what it cannot know, and how the shape of the page may have produced the behaviour it is describing.

The essay argues that a system which counts its own derived records as independent evidence has begun citing itself, and that a user model should preserve the *history* of its claims rather than a polished conclusion. The Mirror is that argument made executable. It is deliberately weak: the strongest thing it will ever say about you is "may have", at moderate confidence, about this session only.

**Why this is a separate repository.** The panel makes checkable claims — nothing leaves your browser, nothing is stored, evidence roots are counted rather than records, the reveal is a causal boundary nothing crosses. Inside a private portfolio those are sentences you have to take on trust. Here they are a tree you can read, tests you can run, and a commit the deployed page links back to. The repository boundary is part of the argument.

---

## The epistemic model

Five physically distinct objects, defined in [`src/types.ts`](src/types.ts):

| | |
|---|---|
| **ReaderEvent** | Something that happened. A section entered, a citation opened, the tab hidden, an activity ping. Raw, timestamped, never interpreted. |
| **Observation** | A deterministic restatement of events. *"About 60 seconds on the archive self-citation passage — longer per word than your median passage in this session."* Carries the ids of the events it came from. |
| **Claim** | An inference *about the reader*, always hedged, always cited. *"You may have spent more attention on mechanisms than on abstract framing."* Carries the ids of its supporting and contradicting observations, its evidence roots, and its authored alternative explanations. |
| **UserResponse** | Your answer: Accurate, Wrong, or More complicated. |
| **ClaimHistoryEntry** | Every state the claim has been in — created, evidence attached, confidence changed, response attached. Append-only. |

They are five types rather than one mutable profile because the failure the essay names is exactly the collapse of the distinction. Once an observation and a claim live in the same array, a claim can be cited as evidence for another claim, and the system is citing itself. Keeping `evidenceEventIds` on observations and `supportingObservationIds` on claims means the provenance chain is a data structure, not a convention — and the audit panel can walk it in front of you.

Alternative explanations are stored on the claim *by id*, resolved from [`src/claims.ts`](src/claims.ts), and marked `source: "author_defined"` wherever they are shown. They are a property of the instrument, not a finding about you.

---

## How the rule engine actually works

There is no model here. No LLM, no embeddings, no remote inference, no classifier. Every rule is a hand-written predicate over the event log, and this is a design decision rather than a scope cut: a language model would make the output read better and its epistemology impossible to inspect, which is the opposite of what the essay is arguing for.

Derivation is a pure function of `(events, manifest, now)`. Given the same log it produces the same observations, the same claims, the same confidences, and the same history — which is what makes the "what this was derived from" panel a real audit rather than a plausible-looking caption.

### What counts as attention

Dwell only accrues while the tab is **visible** *and* the reader has interacted within the last **30 seconds**. Both conditions are reconstructed from the log itself — visibility from `visibility_change` events, activity from throttled `activity` pings emitted every 5 seconds — so an open tab in a background window measures nothing, and neither does a page left on screen while you make coffee. Durations are reported to the nearest five seconds; nothing here is measured to a precision it does not have.

A **passage** must be marked in [`src/manifest.ts`](src/manifest.ts) to be measured at all. Seven passages are marked, across Sections II, III, IV, V, VII and X, with a word count and category tags each. Time spent anywhere else on the page cannot appear, however long it was.

### Observation rules

| Rule | Fires when | Evidence type |
|---|---|---|
| `section_dwell_v1` | ≥ 45s of active reading accumulated in one section | dwell |
| `passage_dwell_above_median_v1` | A marked passage held more active time *per word* than your median marked passage. Silent until at least 3 passages have any dwell at all — there is no median before that. | dwell |
| `abstract_dwell_matches_mechanism_v1` | Median per-word attention on `abstract` passages was ≥ that on `mechanism` passages | dwell |
| `uniform_dwell_v1` | Highest per-word passage dwell was less than 1.4× the lowest — attention was flat | dwell |
| `section_return_count_v1` | You re-entered a section *with a different section in between*. Scrolling back and forth across one boundary is not a return. | return |
| `citation_open_count_v1` | You opened at least one inline reference chip | citation |
| `scroll_direction_reversal_v1` | ≥ 4 reversals of reading direction (each ≥ 240px) | sequence |
| `claim_inspection_count_v1` | You opened the derivation behind a claim. Post-exposure by construction — the claims do not exist before the reveal. | provenance |

The baseline for "above median" is *your own session*. Never other readers: there are no other readers, and a cross-reader baseline would be invented.

The two rows in bold-adjacent positions — `abstract_dwell_matches_mechanism_v1` and `uniform_dwell_v1` — exist only to argue *against* claims. They are derived rather than assumed absent, so the limiting evidence is a record with its own provenance rather than a silence.

### Inference rules

Four rules. Three can become claims; the fourth deliberately cannot.

**`mechanism_affinity_v1`** — *"You may have spent more attention on mechanisms than on abstract framing."*
Requires 2 instances of `passage_dwell_above_median_v1` on passages the manifest marks `mechanism`, **and** 1 episode of `section_return_count_v1`.
Argued against by `abstract_dwell_matches_mechanism_v1` or `uniform_dwell_v1`; either drops it to low confidence.
Ceiling: **moderate**.

**`recursive_attention_v1`** — *"Recursive or self-referential mechanisms may have held your attention."*
Requires 1 instance of `passage_dwell_above_median_v1` on the archive self-citation or performative loop passage specifically, **and** either 1 episode of `section_return_count_v1` or 1 episode of `citation_open_count_v1`.
Argued against by `uniform_dwell_v1`.
Ceiling: **moderate**.

**`evidence_inspection_v1`** — *"You may be inclined to inspect how a claim is supported."*
Requires either 2 separate episodes of `citation_open_count_v1` or 2 separate episodes of `section_return_count_v1`.
Nothing argues against it directly. The limiting case is ordinary linear reading, which is the *absence* of these observations — the rule simply does not fire.
Ceiling: **moderate**.

**`nonlinear_reader_v1`** — *"You have read parts of this essay out of order."*
Requires 2 separate episodes of `section_return_count_v1`.
**Never becomes a claim.** "You scrolled back twice" is already the finding; dressing it up as an inference about the kind of reader you are adds interpretation without adding evidence. It stays an observation, and the code enforces that with `promotable: false` rather than a comment.

Every rule also carries an authored **distortion** note — how this page's own construction could have produced the behaviour — shown next to the claim.

### The gates a claim has to clear

Matching the requirements is not sufficient. Before anything is shown to you:

1. **≥ 2 independent evidence roots.** See below.
2. **A sample worth speaking about**: ≥ 120 seconds of active reading *and* ≥ 4 marked passages with any dwell. Below that, the panel says there is not enough evidence. That is the preferred failure mode, and the fixture `GLANCE` in [`fixtures/sessions/`](fixtures/sessions/index.ts) exists so that lowering a threshold to make the panel look fuller breaks a test.
3. **At most 3 claims exposed.** Sorted strongest first. If the cap bites, two defensible claims serve you better than three.

Rules that matched but were held back are recorded with the reason, and shown.

### How confidence moves

Every claim starts at **low**. It reaches **moderate** only if *all* of:

- ≥ 3 independent evidence roots
- ≥ 2 distinct evidence *types* (dwell, return, citation, sequence, provenance)
- the sample gate above is satisfied
- active time was ≥ 40% of elapsed time — the measurement itself is trustworthy
- **zero** contradicting observations

Otherwise it stays low. There is no third branch.

---

## Why confidence stops at moderate

`Confidence` is `"low" | "moderate"`. That is the entire type. There is no "high", no numeric score, no percentage.

This is not caution for its own sake. Three or four behavioural signals from one reading session, on one page, filtered through hand-written thresholds, cannot support a strong statement about a person. A system that can express "87% confident" will eventually display it, and the number will be read as a measurement when it is an artifact of the thresholds that produced it.

The ceiling is enforced in four independent places, because a rule about restraint that only lives in one is a rule waiting to be widened:

- the **type** admits nothing else (`test/runtime.test.ts` includes a `@ts-expect-error` that fails compilation if the union is widened);
- `deriveConfidence` has no branch above `rule.maximumConfidence`;
- a test asserts that nothing above moderate is ever *shown*, including after a reader agrees with everything;
- a test asserts nothing above moderate was ever *recorded in the history* either — a ceiling on the current value but not the record would leave a claim that had, on paper, once been certain.

Note the shape of `InferenceRule`: `promotable: boolean` and `maximumConfidence: Confidence` are two separate fields. Folding "never becomes a claim" into the confidence union would make it a scale with an escape hatch, and every consumer would then have to remember that the ceiling might not be a confidence level at all.

---

## Evidence roots

**A root is a behavioural episode, not a record.**

You spend 94 seconds on one paragraph in Section II. That produces two observations: time in the section, and time in the passage. Counting those as two pieces of evidence is the failure the essay is named after — the system has generated a second record from the first and is now treating its own output as corroboration.

So a passage visit **inherits the root id of the section visit that contained it** ([`src/observations.ts`](src/observations.ts), `buildVisits`). One episode, one root. Confidence counts `new Set(observations.flatMap(o => o.evidenceRootIds)).size`, never `observations.length`.

Returning to Section II later is a *different* episode and gets its own root, because reading something a second time after reading elsewhere really is independent evidence about your attention in a way that describing the same minute twice is not.

---

## Exposure is a causal boundary

Nothing is shown until you press the reveal control. `mirrorSession.reveal()` has exactly one caller in this tree — the button's `onClick`. No scroll handler, no `IntersectionObserver`, no mount effect can set `exposureTimestamp`.

At that instant the boundary is set, *and then* the `mirror_open` event is recorded — in that order, so the event that opens the panel falls on the post-exposure side of the line it created. The operation is idempotent.

From then on:

- Claims are derived **as of the exposure timestamp**, not as of render time. Re-rendering an hour later produces byte-identical claims.
- Everything you do afterwards goes into a **physically separate array**. `preExposureEvents` and `postExposureEvents` are two collections, not one collection with a flag, because a filter can be forgotten and a missing array cannot.
- Post-exposure reading is still measured, still shown to you, and **feeds nothing**. It is displayed in its own section of the panel, derived through the same rules from the other collection. No exposed claim may cite it or move because of it.
- Answering "Wrong" attaches your response to the claim's history and changes its `status`. It does not change the claim's confidence, its statement, or its evidence — and answering twice appends rather than replaces. The panel says: *"Your response has been attached to the inference."* It does not say the claim has been corrected, because it has not been.
- Answering "Accurate" does not promote `epistemicType` beyond `"inferred"`. Your agreement is not a second observation.

**This freeze rule is specific to this artifact and is not being generalized.** A system that has told you what it thinks of you and then updates on your reaction to being told has contaminated its own evidence, and this panel refuses to. That is a claim about *this* instrument in *this* essay. It is not an argument that persistent personalization systems should never update, and nothing here should be read as one.

---

## Privacy

**What is guaranteed, precisely:** the Mirror sends nothing anywhere, stores nothing anywhere, and holds its entire state in one JavaScript object that the browser discards on reload. There is no `fetch`, no `sendBeacon`, no `WebSocket`, no `localStorage`, no `sessionStorage`, no `IndexedDB`, no cookie, no URL parameter, no worker, no service worker.

**How it is guaranteed:** by the absence of the capability, not by a flag that is currently switched off. A privacy property that depends on `analytics.enabled === false` is one config change away from being false. So instead:

- **Guard A** parses every file in `src/` with the TypeScript compiler API, resolves every identifier through the type checker, and fails on any global not on a closed allowlist, any access to a forbidden member name, and any computed access on `window`, `globalThis`, `self`, `navigator` or `document`. AST rather than regex, specifically because this package documents its own privacy properties in prose and a regex guard would false-positive on its own README.
- **Guard A has a control.** [`fixtures/capability-probe/`](fixtures/capability-probe/) is a file that reaches for every capability this package disclaims, scanned by the same function, with a test asserting the exact set of violations it produces line by line. This exists because the guard once passed while nearly blind: `@types/node` re-declares `fetch`, `localStorage` and `navigator`, and an earlier version of the "is this an ambient global" test exempted exactly those three — the three the guard exists to forbid. **A closed allowlist fails open.** A scanner that resolves nothing reports nothing, and looks identical to a scanner that found nothing. The probe ships in the published tarball on purpose, as a reviewed decision.
- **Guard B** asserts the dependency graph cannot deliver anything: no runtime `dependencies`, `peerDependencies` exactly `{react}`, no `prepare`/`preinstall`/`install`/`postinstall` script, every import specifier relative or exactly `react`, no `node:` builtin in `src/`.
- **Guard C** runs `npm pack --dry-run --json` and diffs the result against [`package-contents.json`](package-contents.json), a reviewed list. `files` in `package.json` declares intent; this records the result. Adding a file to the published package is a diff someone has to approve rather than a side effect of creating one.

**What is *not* guaranteed, and please read this part.** These guards are about *this package*. The Mirror is embedded in a web page, and the page around it is a separate question with a separate answer. The correct sentence is "the Mirror sends nothing", not "the page sends nothing anywhere" — and the second sentence is the one that would be easy to imply and wrong to. Whether the whole essay page is silent is verified in the host repository, against a production build, with a Playwright suite that classifies every request the page makes and installs traps on every exfiltration API. Only there does the question have a whole page to ask it about.

**How to verify it yourself:**

```
npm install
npm run typecheck     # tsc --noEmit, strict
npm run lint
npm run test          # unit + property tests + guards A, B, C
```

Or, on the live page: open DevTools, reveal the Mirror, click everything, and watch the Network and Application tabs. That is the check the guards are a formalization of, and it is the one you should trust more.

---

## Build identity: from a claim on screen to the source that made it

A source link that says "see the page source" is not evidence. The deployed Mirror carries four identifiers, and every rule links to its own lines at the exact revision that is running:

| | |
|---|---|
| `PACKAGE_VERSION` | this package's release |
| `RULESET_VERSION` | the thresholds and rule table; changes when behaviour changes |
| `PASSAGE_MANIFEST_VERSION` | the authorial classification of the prose |
| commit SHA | supplied by the **host application**, from its own lockfile |

The SHA is not in this repository and cannot be: a file inside a commit cannot contain the hash of the commit that contains it. Any package that appears to know its own revision is either reading it back from a build step or reporting a stale one. So the host reads it from `package-lock.json`, where npm already recorded the resolved revision, and passes it in as a **required** `MirrorBuildIdentity` prop — a build that forgets fails `tsc` rather than shipping a panel whose audit links point nowhere. It is an observation about the deployed artifact rather than an assertion the artifact makes about itself.

`RULESET_VERSION` is enforced, not conventional: [`src/ruleset.digest.json`](src/ruleset.digest.json) holds a SHA-256 over a canonical `{thresholds, ruleIds, maximumConfidences}` object, and a test recomputes it. Changing a threshold without bumping the version fails the build.

Per-rule links come from [`src/generated/source-spans.ts`](src/generated/source-spans.ts), a `ruleId → {file, startLine, endLine}` map generated with the TypeScript compiler API. A test regenerates it in memory and deep-equals the committed file, so the line numbers cannot rot. `ruleSourceUrl` returns `undefined` rather than falling back to a file-level link — a link that lands on a four-hundred-line file and leaves you to find the rule is not evidence, and offering one would misrepresent how much has been shown.

The chain closes: your behaviour → a displayed observation → an inference → displayed provenance → a rule id → commit-pinned source lines → the test that demonstrates the invariant.

---

## Known limitations

Stated because a panel about epistemic honesty that hides its own defects is not making its argument.

- **The inferences are weak by design, and still weaker than they look.** Four rules over seven marked passages in one session. "You may have spent more attention on mechanisms" is compatible with being interrupted, with finding that passage harder, with already knowing the surrounding material. Each rule ships its own alternative explanations for exactly this reason, and they are shown next to the claim rather than buried.
- **Session scope only.** Nothing persists. The Mirror knows nothing about you before you opened the page and retains nothing after you close it. `temporalValidity.scope` is `"session"` on every claim, and there is no code path that could widen it.
- **Only marked passages are measured.** Seven of them, chosen by the author. This is itself a distortion the panel discloses: time spent on unmarked prose cannot appear however long it was.
- **Measurement is not viewport-neutral.** Reading with a keyboard, a screen reader, or a phone crosses section boundaries differently than reading with a mouse on a wide screen, and no rule adjusts for that. The original implementation had a harder version of this bug — a fixed 0.35 intersection ratio that tall sections can never reach on a narrow viewport, because `intersectionRatio` is capped at `viewportHeight / elementHeight`. On mobile the panel reported one section measured. That is fixed here; see [`docs/DEVIATIONS.md`](docs/DEVIATIONS.md).
- **Git dependency pinning is not SRI.** npm deletes `integrity` for git dependencies by design. A lockfile entry pins *which* commit was installed — a strong guarantee — and offers no content hash at all. Do not read the build-identity panel as claiming subresource-integrity-grade verification.
- **`ReaderEventType` includes `"activity"`**, which the spec's event list does not. This is deliberate: §6 makes dwell conditional on recent interaction and §35 requires derivation to be pure, so the activity signal has to live in the log rather than in a side channel. Documented in `types.ts` and in the deviations file.

---

## Layout

Directory order follows the epistemic pipeline, so the architecture is legible from `ls`.

```
src/
  types.ts          the five objects
  session.ts        event log, the exposure boundary, the only clock read
  observations.ts   events -> observations (pure)
  claims.ts         observations -> claims, the rule table (pure)
  runtime.ts        the whole model, and the pre/post non-union
  manifest.ts       the versioned passage manifest
  authored.ts       unknowns and distortions: written, never derived
  thresholds.ts     every number, in one place
  version.ts        identifiers
  identity.ts       claim -> commit-pinned source URL
  ui/               MirrorPanel, MirrorShell, Passage, mirror.css
testing/            DOM contract selectors + shared assertions for host repos
fixtures/
  passages/         the seven marked passages as prose snapshots
  sessions/         declarative reading histories the tests consume
  capability-probe/ the control for guard A
tools/              span generation, digest generation, the guards
test/               vitest suites
docs/               the spec, and the deviations from it
```

The reading fixtures ship with the package rather than living in `test/` because they are the readable half of the rule documentation. If you want to know what "lingered on the mechanism passages" means in milliseconds, read `ATTENTIVE` in `fixtures/sessions/index.ts`; if you want to check that it really does produce the claim, run the suite that consumes it.

## Using it

```
npm install github:jstiltner/interactive-mirror#v0.2.0
```

Source-only, on purpose: there is no build step to hide anything in, and a reader auditing the deployed Mirror is reading the same characters the browser ran. Next.js hosts need `transpilePackages: ["@jstiltner/interactive-mirror"]`. Peer dependency: React 18 or 19.

Import `mirror.css` and map the `--mirror-*` custom properties to your own tokens.

Two exports rather than one, for a reason worth knowing about. The instrumentation has to start when the reader arrives, not when the panel finishes loading, or the Mirror reports on whichever part of the session it happened to be present for. The panel itself should not be paid for by a reader who came for the argument rather than the demo. So:

```tsx
// eager: measurement, and the inert shell shown until the panel arrives
import { MirrorShell, Passage, useMirrorInstrumentation } from "@jstiltner/interactive-mirror";
// deferred: the rule table, the claim engine, the panel
const MirrorPanel = dynamic(() => import("@jstiltner/interactive-mirror/panel"), {
  ssr: false,
  loading: () => <MirrorShell identity={identity} />,
});
```

`./panel` is a separate entry point so the split is a property of the module graph rather than a hope about tree-shaking. Both paths resolve the same `session.ts`, so there is exactly one event log.

`MirrorPanel` and `MirrorShell` both take a **required** `identity` prop. A host that forgets it fails `tsc`, which is deliberate — an optional build identity would degrade to a panel whose audit links go nowhere, and a broken link looks like verification in a way an absent one does not.

## Documents

- [`docs/spec-v0.2.md`](docs/spec-v0.2.md) — the authoritative specification, committed as written.
- [`docs/DEVIATIONS.md`](docs/DEVIATIONS.md) — every place this implementation departs from it, and why.

## Licence

MIT. See [`LICENSE`](LICENSE).
