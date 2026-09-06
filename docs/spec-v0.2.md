# Interactive Mirror --- Implementation Specification v0.2

## 1. Purpose

The Interactive Mirror is an in-browser demonstration embedded at
Section VIII of the essay. It constructs a deliberately weak model of
the reader using only behavior observable during the current page
session.

Its purpose is experiential rather than diagnostic. The reader should
encounter the progression the essay has described:

**behavior → observation → inference → recognition or disagreement →
provenance inspection → contestation → post-exposure separation**

The component should be credible enough to produce occasional
recognition while remaining visibly limited enough that the reader can
inspect how recognition was produced.

It must never imply psychological assessment, personality testing,
identity determination, or privileged access to the reader's internal
state.

**Exposure is a deliberate reader action, not a passive scroll event.**
Scrolling Section VIII's framing text into view accumulates ordinary
pre-exposure dwell like any other section; it does not itself trigger
the reflection. The reader must take an explicit action — a control
such as "See what this page thinks" — to reveal the mirror's claims.
That click is the only event that may set `exposureTimestamp` (see
§17, §38).

## 2. Core Design Principle

The implementation distinguishes five epistemic objects:

``` text
Event
  ↓
Observation
  ↓
Inference
  ↓
User Response
  ↓
Epistemic History
```

After the reader views an inference, subsequent events enter a separate
causal partition:

``` text
PRE-EXPOSURE                         POST-EXPOSURE

Events                               Events
  ↓                                    ↓
Observations                         Observations
  ↓                                    │
Inference ──────── EXPOSURE ──────────┤
  ↓                                    │
User response                         │
                                       ↓
                              preserved separately
                              from inference update
```

The production implementation **must not update an exposed inference
from post-exposure behavior**.

This is the central constraint of the experiment.

### Governing invariant

> **Every claim displayed about the reader must be auditable back to
> browser-observed events, and the system must preserve the epistemic
> status and causal history of that claim.**

## 3. Privacy Architecture

Version 1 should be entirely client-side.

No analytics endpoint receives mirror events. No LLM API receives reader
behavior. No cookie or persistent identifier is required. No
cross-session profile is constructed.

Session state lives only in memory. Reloading the page destroys it.

The UI can therefore truthfully state:

> *Built only from your interaction with this page. Processing remains
> in your browser; nothing is transmitted or stored.*

This sentence becomes a testable product requirement. If ordinary site
analytics capture generic page views or scroll telemetry elsewhere on
the site, the wording must be made more precise so it remains literally
true of **the mirror data**. See §23 for how this interacts with
site-wide analytics specifically, and note that the requirement is
verified at the level of the whole page load, not just the widget's own
code — see §23's closing paragraph.

## 4. Platform Integration Constraints

This section did not exist in v0.1 and is added because the component
will be built inside an existing Next.js/React site, not a greenfield
app.

- The Mirror must be a **client component** (`"use client"` in the App
  Router). None of its instrumentation — `IntersectionObserver`,
  `document.visibilityState`, `performance.now()`, pointer/keyboard
  listeners — may execute during server render. Guard all of it behind
  mount-time effects so server and first client render match; a naive
  implementation will otherwise produce hydration mismatches on this
  exact page, which is a bad place for the site to visibly break.
- No mirror instrumentation may run before the component has mounted
  and the browser environment is confirmed available. Server-rendered
  markup for this component should be the inert "insufficient
  evidence" shell (§20), never a guess at reader state.
- Code-split the Mirror's bundle (dynamic `import()`, lazy-loaded)
  rather than shipping it in the essay page's main bundle. A reader who
  never opens the mirror shouldn't pay its JS weight, and this also
  keeps the essay's own prose readable and fast for readers who arrive
  primarily for the argument, not the demo.
- Match the essay page's existing typography, section-heading, and
  citation-styling conventions rather than introducing a visually
  distinct widget skin. The mirror should read as part of the essay,
  not as an embedded product demo bolted onto it.

## 5. Event Model

Raw events should be minimally interpretive.

Candidate event types:

``` ts
type ReaderEvent =
  | SectionEnter
  | SectionExit
  | ScrollDirectionChange
  | PassageReturn
  | VisibilityChange
  | CitationOpen
  | MirrorOpen
  | InferenceOpen
  | InferenceResponse;
```

Each event receives at minimum:

``` ts
interface ReaderEvent {
  id: string;
  type: EventType;
  timestamp: number;
  section?: string;
  target?: string;
  exposureState: "pre" | "post";
}
```

Events should record what happened, not what it supposedly means.

Good:

``` text
section_v visible for 94 seconds
```

Bad:

``` text
reader was interested in Section V
```

"Interested" is already an inference.

## 6. Attention Measurement

Raw elapsed time is too weak because the reader can change tabs, lock
the phone, leave the browser open, or stop interacting.

A section accrues active dwell only when:

``` text
document.visibilityState === "visible"
AND
section intersects viewport above threshold
AND
recent user activity is within inactivity window
```

Recommended inactivity threshold: approximately **30 seconds**.

Interaction capable of resetting activity:

-   scroll
-   pointer movement/touch
-   keyboard activity
-   citation interaction
-   mirror interaction

Avoid excessive precision in the displayed UI. If measurement
uncertainty is meaningful, say:

> About 40 seconds

rather than:

> 41.382 seconds

The latter falsely implies epistemic precision.

## 7. Section Exposure

Use `IntersectionObserver` rather than scroll-position polling.

Each essay section and selected argument passage receives a stable
semantic ID:

``` text
section-i
section-ii
...
section-ix
section-x
```

plus argument passages such as:

``` text
passage-legibility
passage-intuition
passage-performative-loop
passage-epistemic-history
```

A section counts as entered only after exceeding a visibility threshold
for a minimum duration, preventing boundary jitter from manufacturing
visits.

Recommended starting values:

``` text
intersection threshold: 0.35
minimum meaningful exposure: 2 seconds
```

These values should be tuned empirically after implementation.

**Section IX and Section X are read after the mirror's location in the
document, so under normal linear reading they can only ever be
pre-exposure evidence for a reader who has not yet clicked the reveal
control (§1) — most dwell in these two sections will be post-exposure.
Track them anyway.** Post-exposure dwell in Section X specifically is
the single most valuable observation the demo can produce, because
Section X is the essay's own translation of its argument into a memory-
system design — dense with the "mechanism" category the example rule in
§10 measures. If a reader is shown a mechanism-affinity claim and then
spends unusual time in Section X, that is the essay's central warning
occurring live. See §19 for how this must be surfaced without being
allowed to strengthen the already-exposed claim.

## 8. Return Detection

"Returned to Section V twice" requires a defensible definition.

A return occurs when:

1.  reader previously meaningfully exposed Section V;
2.  reader subsequently meaningfully exposed another section;
3.  reader later re-enters Section V;
4.  Section V remains meaningfully visible for the minimum threshold.

Scrolling three pixels across a section boundary must not count as
leaving and returning.

## 9. Reading Velocity

Do **not** infer reading speed from pixels per second.

Sections vary in length, viewport dimensions vary, fonts reflow, and
users skim selectively.

Instead compute approximate active dwell normalized against rendered
textual content:

``` text
active dwell / estimated word count
```

Comparison should primarily be **within the reader's own session**.

Thus:

> Spent longer than your median reading time on Section V.

is defensible.

This is preferable to:

> You read Section V slowly.

The first describes a relative measurement. The second attributes a
behavior whose meaning is ambiguous.

## 10. Observation Layer

Observations are deterministic transformations of events.

Example:

``` ts
interface Observation {
  id: string;
  statement: string;
  evidenceEventIds: string[];
  derivedAt: number;
  exposureState: "pre" | "post";
  ruleId: string;
}
```

Example:

``` json
{
  "id": "obs_17",
  "statement": "Returned to Section V twice.",
  "evidenceEventIds": ["evt_19", "evt_42", "evt_61"],
  "ruleId": "section_return_count_v1",
  "exposureState": "pre"
}
```

Every displayed observation must be reproducible from its referenced
events.

## 11. Inference Architecture

Version 1 should use **deterministic, hand-authored inference rules**.

Do not call an LLM.

An LLM would make the demo superficially more impressive while making
its epistemology much harder to inspect. The essay benefits from the
opposite.

Example rule:

``` ts
interface InferenceRule {
  id: string;
  requiredObservations: string[];
  contradictoryObservations?: string[];
  inference: string;
  alternatives: string[];
  confidenceFn: (...) => Confidence;
}
```

Possible inference:

> You may prefer mechanisms to abstractions.

Supporting observations might include:

-   dwell ratio on mechanism-heavy passages \> session baseline;
-   ≥1 return to mechanism-heavy passage;
-   dwell ratio on designated abstract passages below baseline.

No single observation should generate a moderate-confidence inference of
this kind.

## 12. Semantic Passage Classification

The code needs an author-defined manifest describing what passages are
being treated as examples of various categories:

``` ts
const passageManifest = {
  "performative-loop": {
    categories: ["mechanism", "formal"],
    section: "V"
  },

  "legibility-discussion": {
    categories: ["abstract", "epistemic"],
    section: "II"
  },

  "archive-self-citation": {
    categories: ["mechanism", "formal", "recursive"],
    section: "II"
  },

  "memory-system-design": {
    categories: ["mechanism", "architecture"],
    section: "X"
  }
};
```

`archive-self-citation` (Section II's consolidation/k+s passage) and
`performative-loop` (Section V) are distinct passages in distinct
sections; do not collapse them into one manifest entry even though both
support the `recursive_attention_v1` rule (§31). `memory-system-design`
(Section X) is a post-exposure-only passage for most readers — see §7
and §19.

These classifications are **authorial judgments**, not facts discovered
from reader behavior.

The UI's "Possible distortion" section should expose this when relevant:

> This essay contains more formal machinery in some sections than
> others. Your behavior may reflect the structure of the page as much as
> a stable characteristic of you.

This makes the manifest itself part of the provenance chain.

## 13. Confidence

Avoid fake probability.

Do not display:

> 73% confidence.

There is no calibrated statistical model supporting that number.

The full ordinal scale the essay's epistemics contemplate is:

``` text
Low
Moderate
Relatively strong
```

**"Relatively strong" is out of scope for v1.** Do not implement it, do
not include it in the `Confidence` type (§29 defines only `"low" |
"moderate"`), and do not leave a reachable code path that could produce
it. Given the tiny sample any single mirror session can gather, a
claim at "relatively strong" would contradict the essay's own argument
about what a few minutes of behavior can support. Treat it as a label
reserved for a hypothetical future version with a materially different
evidence base, not a v1 tier that's merely unused.

Confidence should be rule-derived from:

-   number of independent supporting observations;
-   diversity of evidence types;
-   presence of contradictory observations;
-   sample sufficiency;
-   measurement quality.

Importantly, repeated derivatives of one underlying event do not count
as independent evidence.

That operationalizes **"the archive has begun citing itself."**

## 14. Independence Tracking

Observations should retain parentage.

For example:

``` text
evt_14
 ↓
obs_long_dwell_v
 ↓
inf_mechanism_preference
```

If another observation is derived from the same underlying dwell event,
the confidence system must recognize shared ancestry.

Conceptually:

``` ts
evidenceRoots(inference)
```

should count unique raw-event families rather than merely the number of
observation records.

This is one of the places where the implementation can quietly embody
the essay rather than merely illustrate it.

## 15. Inference Presentation

The initial reflection should preserve the manuscript's categories:

**OBSERVED**

**INFERRED**

**UNKNOWN**

**POSSIBLE DISTORTION**

That hierarchy is epistemically meaningful.

Observation and inference should look visually distinct. "Unknown"
should receive comparable visual weight rather than being buried as
disclaimer text.

The system is demonstrating what it does **not** know.

## 16. Inference Detail

Selecting an inference opens its provenance.

Example:

> **You may prefer mechanisms to abstractions.**
>
> Confidence: **Moderate**
>
> Derived from: - Longer dwell around formal models - Two returns to
> mechanism-heavy examples - Faster passage through several abstract
> discussions
>
> Plausible alternatives: - You were checking whether the formalism was
> coherent. - The examples were harder to understand. - You already knew
> the surrounding philosophical material. - You were interrupted
> elsewhere on the page.

Every "Derived from" item must correspond to a real observation object.

Alternative explanations may be authored because they are explicitly
labeled as plausible alternatives, not observations.

## 17. Contestation

The reader can respond:

``` text
Accurate
Wrong
More complicated
```

Internally:

``` ts
interface UserResponse {
  inferenceId: string;
  response:
    | "endorsed"
    | "disputed"
    | "qualified";
  timestamp: number;
}
```

Crucially:

``` text
response ≠ ground truth
```

"Wrong" must **not** mutate:

``` text
inference.status = false
```

Instead:

``` text
inference.history.push({
    type: "user_contestation",
    response: "disputed"
})
```

Likewise, "Accurate" does not promote the inference to fact.

This implements:

> **Your response has been attached to the inference.**

literally.

## 18. Exposure Boundary

The moment the reader takes the explicit reveal action described in §1
creates:

``` ts
exposureTimestamp
```

No other event — not scrolling Section VIII into view, not dwelling on
its framing text, not opening a citation near it — may set this
timestamp. All events thereafter become:

``` text
exposureState = post
```

Pre-exposure inference data freezes.

This includes behavior elsewhere in Section VIII after opening the
mirror.

The system may continue recording post-exposure observations for the
demonstration, but they cannot feed back into the existing inference.

## 19. Post-Exposure State

The component eventually displays:

> **Since viewing your reflection**
>
> New observations are available.
>
> **Model update: withheld**
>
> *Post-exposure observations preserved separately.*

This must be literally true.

Internally:

``` ts
const preExposureEvidence = ...
const postExposureEvidence = ...
```

There should be no function that silently merges them.

Make this architectural rather than conditional---separate collections,
not a boolean filter applied later.

### 19a. The Section X case, specifically

Because Section X is read almost entirely post-exposure (§7), it is the
demo's best opportunity to make §2's central constraint visible rather
than theoretical. If the reader was shown a mechanism-affinity claim
and then dwells unusually long in Section X, the post-exposure panel
should be able to name this directly — something like:

> You've spent longer than average on Section X since seeing this. That
> fits the claim above. It is not being used to strengthen it.

This is not a new mechanism; it is the existing post-exposure/pre-
exposure partition (§2, §18) applied to the one passage in the essay
best suited to demonstrate why the partition matters. Do not build a
separate code path for it — it should fall out of the same
`postExposureObservations` collection and the same non-merging
guarantee as everything else in this section.

## 20. Minimum Evidence Behavior

A reader may arrive at VIII with insufficient interaction history.

The component must **not fabricate a portrait** just to make the demo
work.

Instead:

> **I don't have enough evidence yet.**
>
> You've reached the mirror with too little observable interaction for
> me to make even a weak inference responsibly.
>
> What I can observe so far: - ...
>
> What I cannot infer: - ...

This failure state is philosophically valuable.

The mirror refusing to invent a person may be one of its best outcomes.

This is also the correct server-rendered/pre-hydration state per §4 —
never render a guessed reflection while the client is still mounting.

## 21. Mobile Behavior

This matters substantially because dwell and viewport telemetry behave
differently on phones.

The component must handle:

-   touch scrolling;
-   small viewport;
-   browser chrome resizing;
-   background/foreground transitions;
-   accidental section crossings during momentum scroll;
-   orientation change.

Mobile users should receive the same epistemic categories, even if fewer
inference rules qualify.

No desktop-only interaction should be required. The reveal control from
§1 must be a real tappable element, not a hover-triggered affordance.

## 22. Accessibility

All mirror functions must work with keyboard navigation and screen
readers.

Semantic requirements:

-   actual buttons;
-   appropriate headings;
-   focus management when inference detail opens;
-   `aria-live` for response-state changes;
-   no inference encoded solely through color;
-   reduced-motion support;
-   readable contrast.

Accessibility behavior must not be treated as noise. Keyboard
navigation, for example, may alter dwell patterns. The mirror should
avoid inference rules that presume a particular input modality.

## 23. Analytics Firewall

If Jasonstiltner.com uses ordinary analytics, create a conceptual
firewall:

``` text
SITE ANALYTICS
page view
general traffic
performance

        X

MIRROR SESSION
section dwell
returns
inference evidence
contestation
exposure history
```

Mirror data should never enter the site's analytics pipeline.

Otherwise the sentence "nothing is transmitted or stored" becomes false
in the way that matters most to the essay.

**This firewall is necessary but not sufficient on its own.** The essay
page also needs page-level network hygiene — no third-party analytics
or telemetry script loading on this specific route, fonts self-hosted
rather than fetched live from a font CDN — which is a separate,
already-agreed requirement for the page this component lives on, not
this document's concern to specify in detail. The two must be verified
together: a Network-tab check that only watches the mirror's own code
while a page-view beacon still fires from the surrounding page passes
this section's tests while leaving the essay's actual claim false.
§41's release requirements should be run against the whole page load,
not against the mirror component in isolation.

## 24. No Dark Personalization

The mirror must not use its inference to alter the essay.

Do not:

-   reorder paragraphs;
-   change examples;
-   alter wording;
-   personalize later arguments;
-   hide/show scholarship;
-   modify recommendations.

That would introduce a second performative mechanism and make the
experiment much harder to interpret.

The essay remains fixed.

Only the mirror responds.

## 25. Debug / Audit Mode

Development builds should include an optional audit panel:

``` text
RAW EVENTS
OBSERVATIONS
INFERENCE RULES FIRED
EVIDENCE ROOTS
EXPOSURE BOUNDARY
POST-EXPOSURE EVENTS
```

For every inference we should be able to answer:

``` text
Why did this appear?
```

without reading application logs or reconstructing behavior manually.

This audit mode should be used heavily before publication and omitted or
hidden from the ordinary reader experience.

## 26. Test Invariants

The most important automated test should effectively be:

``` text
For every visible claim C:

C is either
  (a) a deterministic observation backed by recorded events,
  (b) an explicitly labeled inference backed by observations,
  (c) an explicitly labeled alternative explanation,
  (d) an explicitly labeled unknown,
  (e) a recorded user response.

No other epistemic category may masquerade as fact.
```

And the second:

``` text
No post-exposure event may increase,
decrease, confirm, refute, or otherwise
modify an exposed inference.
```

## 27. Success Criteria

Do **not** measure success by how many readers say the portrait was
accurate.

The strongest outcome is that a reader can simultaneously think:

> That's surprisingly plausible.

and:

> I can see exactly why it thinks that, and exactly where it might be
> wrong.

The component succeeds when recognition produces **inspection rather
than surrender**.

That is the essay in miniature.

## 28. Architectural Decision for v1

Version 1 should contain **no generative AI**.

Hand-authored inference rules make the demonstration more intellectually
rigorous, more private, easier to audit, and technically more aligned
with the essay's argument. Using a black-box model to manufacture the
demonstration would obscure the provenance the component exists to
expose.

Sections 29 onward (originally drafted as a second specification pass)
provide the complete data schemas, explicit state machine, inference-
rule table, acceptance tests, and implementation milestones this
decision implies.

## 29. Demonstration vs. Production Architecture

The essay now makes two related but different prescriptions.

For the **Interactive Mirror**, the rule is strict:

``` text
pre-exposure evidence → claim → exposure → post-exposure evidence
                                      ↓
                           preserved separately
                           model update withheld
```

The Mirror is a deliberately weak, single-session experiment. It cannot
observe the same reader both exposed and unexposed, so post-exposure
behavior cannot revise an already exposed claim.

A real **persistent advisor** cannot freeze every claim forever after
first exposure. It should instead tag later evidence as post-exposure,
preserve its causal status, report how much support arose after
exposure, and avoid treating that evidence as independent confirmation
of the representation that may have helped produce it.

The Mirror intentionally implements the stronger rule because its
purpose is to make the causal boundary inspectable.

## 30. Complete Data Schemas

The implementation should use immutable IDs and append-only epistemic
history wherever practical.

``` ts
type ExposureState = "pre" | "post";
type Confidence = "low" | "moderate";
type ClaimStatus =
  | "candidate"
  | "exposed"
  | "endorsed"
  | "disputed"
  | "qualified";

interface ReaderEvent {
  id: string;
  type:
    | "section_enter"
    | "section_exit"
    | "scroll_direction_change"
    | "passage_return"
    | "visibility_change"
    | "citation_open"
    | "mirror_open"
    | "claim_open"
    | "claim_response";
  timestamp: number;
  section?: string;
  target?: string;
  exposureState: ExposureState;
  metadata?: Record<string, string | number | boolean>;
}

interface Observation {
  id: string;
  statement: string;
  evidenceEventIds: string[];
  evidenceRootIds: string[];
  derivedAt: number;
  exposureState: ExposureState;
  ruleId: string;
}

interface Claim {
  id: string;
  statement: string;
  epistemicType: "inferred";
  status: ClaimStatus;
  createdAt: number;
  exposedAt?: number;
  confidence: Confidence;
  supportingObservationIds: string[];
  contradictingObservationIds: string[];
  evidenceRootIds: string[];
  alternativeExplanationIds: string[];
  temporalValidity: TemporalValidity;
  history: ClaimHistoryEntry[];
}

interface TemporalValidity {
  scope: "session";
  validFrom: number;
  lastSupportedAt: number;
  note:
    | "session_behavior_only"
    | "insufficient_evidence"
    | "post_exposure_boundary";
}

interface AlternativeExplanation {
  id: string;
  claimId: string;
  statement: string;
  source: "author_defined";
}

interface UserResponse {
  id: string;
  claimId: string;
  response: "endorsed" | "disputed" | "qualified";
  timestamp: number;
}

interface ClaimHistoryEntry {
  id: string;
  claimId: string;
  timestamp: number;
  type:
    | "claim_created"
    | "evidence_attached"
    | "confidence_changed"
    | "claim_exposed"
    | "user_response_attached"
    | "post_exposure_observation_recorded";
  payload: Record<string, unknown>;
}

interface MirrorSession {
  startedAt: number;
  exposureTimestamp?: number;
  preExposureEvents: ReaderEvent[];
  postExposureEvents: ReaderEvent[];
  observations: Observation[];
  claims: Claim[];
  responses: UserResponse[];
}
```

### Data-model invariants

1.  `Claim.statement` never silently changes after exposure.
2.  A reader response appends history; it never overwrites the claim.
3.  `evidenceRootIds` resolve to independent raw-event families.
4.  `exposedAt` is immutable once set, and can only be set by the
    explicit reveal action defined in §1/§18 — never by a section-enter
    or dwell event.
5.  Events created after `exposureTimestamp` can never enter the support
    or contradiction set for an already exposed Mirror claim.
6.  Temporal validity is session-scoped. The component must never imply
    that a page-session claim is a durable personality fact.
7.  Unknowns come from explicit capability boundaries, not inverse
    inference.

## 31. Explicit State Machine

``` text
COLLECTING
    │
    ├── mirror opened + insufficient evidence ─→ INSUFFICIENT
    │
    └── sufficient evidence ───────────────────→ READY
                                                   │
                                              mirror opened
                                                   ↓
                                                EXPOSED
                                                   │
                                     response optional
                                                   ↓
                                             POST_EXPOSURE
```

**COLLECTING** --- Pre-exposure events accumulate. Observations are
derived deterministically. Candidate claims may be evaluated internally
but are not displayed.

**INSUFFICIENT** --- The reader clicks the reveal control (§1) without
enough independent evidence accumulated. Display observations and
unknowns only. Do not lower thresholds to manufacture an inference.
Clicking reveal still establishes the exposure boundary even in this
state.

**READY** --- At least one claim meets minimum evidence requirements.
Eligible claims freeze for presentation.

**EXPOSED** --- `exposureTimestamp` is set exactly once, by the reveal
click, before reflection rendering. All subsequent events route to
post-exposure storage.

**POST_EXPOSURE** --- Reader responses append to claim history. New
observations may be shown separately (see §19a for the Section X case
specifically). Existing exposed claims remain unchanged.

## 32. Initial Inference-Rule Table

Version 1 should ship with a deliberately small rule set. Three exposed
claims is the hard maximum; one or two defensible claims are better than
three weak ones.

  ---------------------------------------------------------------------------------------------------
  Rule                       Candidate claim    Required evidence       Limiting       Maximum
                                                                        evidence       
  -------------------------- ------------------ ----------------------- -------------- --------------
  `mechanism_affinity_v1`    You may spend more Above-median active     Similar or     Moderate
                             attention on       dwell on ≥2 mechanism   greater        
                             mechanisms than on passages; ≥1 meaningful attention to   
                             abstract framing.  return; ≥2 independent  abstract       
                                                roots.                  passages; weak 
                                                                        sample.        

  `recursive_attention_v1`   Recursive or       Meaningful dwell on     Uniformly long Moderate
                             self-referential   `archive-self-citation` dwell;         
                             mechanisms may     (§12, Section II) and/or inactivity     
                             hold your          `performative-loop`     uncertainty.   
                             attention.         (§12, Section V) plus a                
                                                return or provenance                   
                                                interaction.                           

  `evidence_inspection_v1`   You may be         Citation/provenance     Only ordinary  Moderate
                             inclined to        interactions or         linear         
                             inspect how a      repeated returns to     reading.       
                             claim is           evidence-heavy examples                
                             supported.         before exposure.                       

  `nonlinear_reader_v1`      You have read      ≥2 defensible returns   Boundary       Prefer
                             parts of this      across section          jitter or      observation
                             essay nonlinearly. boundaries.             momentum       
                                                                        scrolling.     
  ---------------------------------------------------------------------------------------------------

Every rule must specify required observations, contradictory evidence,
minimum independent roots, sample sufficiency, possible distortions,
alternative explanations, maximum confidence, and passage-manifest
dependencies.

No rule may infer personality type, intelligence, political orientation,
mental state, profession, demographic identity, diagnosis, or a stable
preference extending beyond the current reading session.

## 33. Evidence Independence

Derived records must not multiply apparent evidence.

``` text
94 seconds active dwell in Section V
        ├── above-median dwell
        └── high normalized dwell
```

Those are two observations with **one evidence root**.

Confidence uses unique root families, not observation count. If several
observations ultimately trace to one behavioral episode, the UI must not
describe them as independent signals. This operationalizes the essay's
warning that **the archive has begun citing itself**.

## 34. Versioned Passage Manifest

``` ts
interface PassageDefinition {
  id: string;
  section: string;
  wordCount: number;
  categories: Array<
    | "mechanism"
    | "formal"
    | "abstract"
    | "epistemic"
    | "example"
    | "architecture"
    | "recursive"
  >;
  manifestVersion: string;
}
```

The manifest is authorial interpretation and therefore part of the
epistemic machinery. It must live in the public source repository.
Changing passage classification requires a version change and test
review. The manifest must include entries for `archive-self-citation`
(Section II) and `memory-system-design` (Section X) in addition to the
examples already given in §12 — both are load-bearing for rules in §32
and for the §19a demonstration, and neither should be left as an
unfilled example.

## 35. Pure Observation Derivation

Observation rules should be pure functions:

``` ts
type ObservationRule =
  (
    events: readonly ReaderEvent[],
    manifest: readonly PassageDefinition[]
  ) => Observation[];
```

Given identical event history and manifest version, the component must
produce identical observations.

## 36. Confidence Derivation

Confidence remains ordinal. A candidate begins at `low` and may become
`moderate` only when all are true:

``` text
independent evidence roots >= 3
evidence types >= 2
sample sufficiency met
no strong contradictory observation
measurement quality acceptable
```

No Mirror claim becomes anything beyond `moderate` in v1 (§13).
Confidence is never displayed as a percentage. Mixed evidence remains
visible rather than being averaged away.

## 37. Conservative Minimum Evidence

Suggested starting defaults:

``` text
meaningful section exposure: >= 2 s
active-session minimum before inference: >= 120 s
meaningfully exposed passages: >= 4
independent roots for any claim: >= 2
independent roots for Moderate: >= 3
inactivity cutoff: 30 s
```

These are implementation defaults, not theoretical constants. Tune them
empirically for defensibility, never to maximize the percentage of
readers who receive a portrait. The preferred failure mode is
**insufficient evidence**.

## 38. Atomic Exposure

Opening the mirror is an atomic transition, triggered only by the
explicit reveal action from §1. Set the exposure boundary **before**
rendering the reflection so events generated during rendering or
interaction cannot leak into pre-exposure evidence.

``` ts
function exposeMirror(session: MirrorSession): MirrorSession {
  if (session.exposureTimestamp) return session;

  const timestamp = performance.now();

  return {
    ...session,
    exposureTimestamp: timestamp,
    claims: freezeEligibleClaims(session.claims, timestamp)
  };
}
```

## 39. Physical Post-Exposure Partition

Use physically distinct collections:

``` ts
preExposureEvents
postExposureEvents
```

and preferably:

``` ts
preExposureObservations
postExposureObservations
```

rather than a single collection filtered later. An exposed claim's
evidence resolver accepts only pre-exposure observation IDs. Development
builds should throw if post-exposure evidence reaches an exposed Mirror
claim. This is the same partition §19a's Section X handling relies on —
no separate storage path should be built for that case.

## 40. Reader-Facing Information Architecture

The first reflection view presents, in order:

``` text
OBSERVED
INFERRED
UNKNOWN
POSSIBLE DISTORTION
```

A claim detail view presents:

``` text
Claim
Confidence
Evidence
Plausible alternatives
Possible distortion
Response controls
```

After a response, display literally:

> **Your response has been attached to the inference.**

Do not display "Profile corrected" or "I'll remember that."

After exposure, a separate region may display:

> **Since viewing your reflection**

and, when new observations exist:

> **Model update: withheld**\
> *Post-exposure observations preserved separately.*

## 41. Open-Source Inspectability

The manuscript's privacy and provenance claims must be checkable rather
than trusted.

The published component should link directly to source responsible for:

-   event collection;
-   activity/dwell calculation;
-   observation rules;
-   passage manifest;
-   inference rules;
-   confidence derivation;
-   exposure partition;
-   persistence/network behavior.

A generic repository homepage is insufficient if a direct source
directory or file link is practical.

**Source links are necessary but not sufficient.** Most readers will
not read the TypeScript. Alongside the source links, ship a short
plain-language explanation — not a simplified claim, an accurate one in
ordinary prose — of how the rule engine actually works: that inferences
come from a small table of thresholds an author wrote in advance, what
counts as independent evidence, and why post-exposure behavior can't
change an already-shown claim. A reader who can verify the code and a
reader who can only verify the prose should both come away able to
check the same claims.

A technically capable reader should be able to verify:

``` text
no Mirror-event fetch/XHR
no localStorage
no sessionStorage
no cookies
no external inference API
no Mirror-event analytics emission
```

If the hosting platform performs unavoidable telemetry, reader-facing
copy must distinguish platform telemetry from the Mirror's own data
path.

## 42. Network and Persistence Guards

Development and CI should instrument browser network primitives while
exercising the full Mirror workflow.

Release requirements:

``` text
Mirror interaction causes zero Mirror-originated network requests.
Mirror state is absent from localStorage.
Mirror state is absent from sessionStorage.
Mirror state is absent from IndexedDB.
Mirror state is absent from cookies and URL parameters.
Reloading destroys the Mirror session.
```

**Run this check against the whole essay page load, not the mirror
component in isolation** (§23) — the Network tab a skeptical reader
opens doesn't know the difference between the widget's requests and the
page's, and the essay's claim doesn't distinguish them either.

Tests should cover opening the mirror, inspecting provenance, responding
to claims, and generating post-exposure observations.

## 43. Accessibility Acceptance Requirements

The complete workflow must work by keyboard alone: enter the component,
inspect all four epistemic categories, open a claim, inspect evidence,
submit each response type, and reach the post-exposure state.

Screen-reader output must announce response attachment and model-update
withholding. No category may depend on color alone. At 320 CSS pixels,
the component must reflow without page-level horizontal scrolling.

## 44. Mobile Measurement Requirements

Tests must cover momentum scrolling, background/foreground transitions,
orientation changes, dynamic browser chrome, touch-only interaction, and
viewport resizing.

A backgrounded document accrues zero active dwell. A momentum-scroll
boundary crossing shorter than the meaningful-exposure threshold does
not count as a section visit or return.

## 45. Failure States

**Insufficient evidence:** render observations and unknowns, no
inference.

**Measurement uncertainty:** downgrade or suppress affected
observations.

**Unsupported browser capability:** preserve a reduced experience and
identify what measurement is unavailable.

**Unresolvable provenance:** suppress the affected claim. Never display
a claim whose evidence chain cannot be reconstructed.

## 46. Release-Blocking Acceptance Tests

**Provenance:** every visible observation resolves to raw events; every
visible inference resolves to observations; every observation resolves
to evidence roots; alternatives are explicitly authored/plausible; every
user response creates a claim-history entry.

**Independence:** multiple derivations of one behavioral episode count
as one root; confidence cannot rise because the same evidence was
transformed twice.

**Exposure:** the timestamp is set once, only by the explicit reveal
action (§1, §18); later events route only to post-exposure storage;
post-exposure observations cannot modify exposed Mirror claims; opening
provenance after exposure cannot manufacture pre-exposure evidence.

**Contestation:** `Accurate` never converts an inference to fact;
`Wrong` never deletes it; `More complicated` never synthesizes a hidden
replacement claim.

**Privacy:** zero Mirror-originated network requests across the whole
page load (§23, §42); zero persistent browser storage; reload clears
the session; Mirror events never enter ordinary analytics.

**UI truthfulness:** insufficient evidence never produces a portrait;
confidence is never numeric and never exceeds Moderate (§13); Unknown
and Possible Distortion remain visible; post-exposure behavior is
labeled.

## 47. Property / Invariant Tests

Where practical, randomized event histories should assert:

``` ts
forAll(eventHistories, history => {
  const result = deriveMirror(history);

  assert(allVisibleClaimsHaveProvenance(result));
  assert(noPostExposureEvidenceMutatesExposedClaims(result));
  assert(confidenceNeverExceedsModerate(result));
  assert(noEvidenceRootDoubleCounting(result));
});
```

The goal is to make violations of the essay's central epistemic
commitments difficult to introduce accidentally during refactoring.

## 48. Debug Audit View

Development mode should allow traversal:

``` text
CLAIM
  ↓
OBSERVATIONS
  ↓
EVIDENCE ROOTS
  ↓
RAW EVENTS
```

and:

``` text
CLAIM
  ↓
HISTORY
  ├── created
  ├── evidence attached
  ├── exposed
  ├── user response attached
  └── post-exposure evidence recorded separately
```

Also show manifest version, rule version, confidence inputs,
contradictory evidence, sample sufficiency, and exposure timestamp.

If an engineer cannot explain why a claim appeared from this view alone,
the implementation is not ready.

## 49. Implementation Milestones

**Milestone 1 --- Instrumentation.** Semantic passage IDs (including
`section-x` and `memory-system-design`, §7/§12), `IntersectionObserver`,
activity tracking, visibility handling, physical pre/post event stores,
development event viewer, client-component/hydration boundary per §4.
Exit: deterministic traces inspectable on desktop and mobile, with no
server/client render mismatch.

**Milestone 2 --- Observation engine.** Pure observation rules,
evidence-root ancestry, dwell normalization, return detection, versioned
passage manifest. Exit: saved event fixtures reproduce observations
exactly.

**Milestone 3 --- Claim engine.** First-class `Claim`, inference rules,
contradiction handling, ordinal confidence (capped at Moderate, §13),
alternatives, insufficient-evidence behavior. Exit: fixtures produce
expected claims and none exceeds Moderate.

**Milestone 4 --- Exposure and contestation.** Explicit reveal control
(§1), atomic exposure, frozen Mirror claims, post-exposure partition
including the Section X case (§19a), claim-history events, reader
responses. Exit: automated tests prove post-exposure evidence cannot
mutate exposed claims, and that only the reveal action can set
`exposureTimestamp`.

**Milestone 5 --- Reader interface.** Four epistemic categories,
provenance view, response controls, post-exposure panel,
responsive/mobile behavior, accessibility, code-split loading (§4).
Exit: full workflow passes keyboard, screen-reader, and narrow-viewport
tests.

**Milestone 6 --- Privacy and inspectability.** Source links, plain-
language explanation (§41), network/persistence guards run against the
whole page load, analytics-firewall verification coordinated with
page-level font/telemetry scoping (§23), final privacy copy. Exit: a
reviewer can verify the component's data path from source and CI, and a
non-technical reader can verify it from the plain-language explanation
alone.

**Milestone 7 --- Adversarial QA.** Attempt false returns, inflated
dwell, duplicated evidence, stale pre-exposure events, post-exposure
leakage, and misleading confidence. Exit: failures are fixed or
explicitly represented as measurement limitations.

**Milestone 8 --- Publication calibration.** Run real reading sessions
and tune thresholds conservatively. Do not optimize for portrait
frequency, endorsement rate, eeriness, or engagement time. Optimize for
provenance correctness, measurement defensibility, epistemic-category
correctness, and the reader's ability to inspect why a claim appeared.

## 50. Definition of Done

The component is publication-ready when:

1.  It can produce a plausible inference without generative AI or
    server-side profiling.
2.  Every displayed claim traces through observations to raw browser
    events.
3.  Evidence cannot become apparently independent through repeated
    derivation.
4.  Unknowns and possible distortions remain visible alongside the
    portrait.
5.  Contestation becomes claim history rather than truth assignment.
6.  Exposure creates a hard causal boundary in the demonstration,
    triggered only by the explicit reveal action defined in §1.
7.  Post-exposure behavior is preserved separately and cannot revise an
    exposed Mirror claim — including, specifically, post-exposure
    dwell in Section X (§19a).
8.  The manuscript and UI make clear that production advisors require a
    different treatment: post-exposure evidence remains usable only with
    its causal status preserved.
9.  Mirror data is neither transmitted nor persisted, verified against
    the whole page load rather than the component in isolation (§23,
    §42).
10. Relevant source code is public, accompanied by a plain-language
    explanation (§41), and the privacy/provenance claims are
    independently inspectable by both technical and non-technical
    readers.
11. The workflow is accessible and functional on mobile, built as a
    client component with no server/hydration mismatch (§4).
12. Insufficient evidence produces an honest refusal to infer.
13. Release-blocking invariants and adversarial QA pass.

The desired experience remains:

> *That's surprisingly plausible.*

followed immediately by:

> *I can see exactly why it thinks that, and exactly where it might be
> wrong.*

Recognition should produce inspection rather than surrender.
