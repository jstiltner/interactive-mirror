/**
 * Every number that changes what the mirror can say, in one file (spec v0.2 §6, §7, §9, §32,
 * §36, §37, §41).
 *
 * These were previously spread across the three modules that use them, which is where a constant
 * naturally wants to live. They were gathered here for one reason: §41 asks the live mirror to
 * link a reader to the rules that produced their reflection, and a rule set you cannot point at
 * is not one a reader can check. `ruleset.digest.json` is a hash over this file's values plus the
 * rule table, so a threshold cannot move without either the digest test failing or
 * `RULESET_VERSION` being bumped to say that it moved.
 *
 * What is deliberately *not* here: `NOTIFY_THROTTLE_MS` and `CLOCK_TICK_MS` in `session.ts`. Those
 * govern how often React re-renders and how often the readiness counter ticks. Neither can change
 * an observation or a claim, so putting them under the digest would make the version number say
 * "the rules changed" when only the frame rate did.
 */

// --- measurement (what reaches the log at all) -----------------------------------------

/**
 * §7. A target is being looked at when 35% of *it* is on screen, or when it covers 35% of the
 * *viewport* — whichever happens first.
 *
 * The second clause is not a refinement. `intersectionRatio` is a fraction of the element, so it
 * is capped at `viewportHeight / elementHeight`: a 1800px section can never exceed 0.22 on an
 * 400px-tall phone screen, and the original one-sided test therefore never fired for a single
 * numbered section on mobile. The mirror reported "1 section measured" for readers who had read
 * the whole essay. Measuring occupancy of the viewport as well is what makes §21's promise — the
 * same rules for a phone reader — true rather than stated.
 */
export const INTERSECTION_THRESHOLD = 0.35;

/** §8. Three pixels across a boundary is not a visit. */
export const MIN_MEANINGFUL_EXPOSURE_MS = 2000;

/** §6. Dwell only accrues while the reader has done something recently. */
export const INACTIVITY_WINDOW_MS = 30_000;

/**
 * How often a continuing interaction is written down. Scroll and pointermove fire at frame rate;
 * recording every one would put tens of thousands of records in a log whose entire purpose is to
 * be small enough for a reader to audit. Well inside the inactivity window, so derived dwell is
 * unaffected.
 */
export const ACTIVITY_PING_MS = 5000;

/** Direction has to actually reverse, not jitter. One viewport-ish of travel the other way. */
export const SCROLL_DIRECTION_MIN_DELTA_PX = 240;

// --- observation (§9, §10) --------------------------------------------------------------

/** A section has to hold a reader for this long before its dwell is worth a sentence. */
export const SECTION_DWELL_MIN_MS = 45_000;

/** A median over one or two passages is not a median. */
export const MIN_PASSAGES_FOR_MEDIAN = 3;

/** Below this, "reversed direction" is just how people read on a small screen. */
export const MIN_DIRECTION_REVERSALS = 4;

/** Dwell-per-word this tightly clustered is not a preference, it is a reading pace. */
export const UNIFORM_DWELL_MAX_SPREAD = 1.4;

// --- claim (§32, §36, §37) --------------------------------------------------------------

/** §37 conservative defaults. Tuned for defensibility, never to raise the hit rate. */
export const MIN_ACTIVE_SESSION_MS = 120_000;
export const MIN_MEANINGFUL_PASSAGES = 4;
export const MIN_ROOTS_FOR_CLAIM = 2;
export const MIN_ROOTS_FOR_MODERATE = 3;
export const MIN_EVIDENCE_TYPES_FOR_MODERATE = 2;

/** §32: three exposed claims is the hard maximum, and fewer is better. */
export const MAX_EXPOSED_CLAIMS = 3;

/**
 * Below this share of the session spent present and interacting, dwell comparisons are being
 * drawn across a lot of absence. The claim can still be made; it cannot be made at moderate.
 */
export const MIN_ATTENTION_RATIO = 0.4;

/**
 * The digest's input. Ordered and named explicitly rather than assembled by reflection, so the
 * hash is a statement about a fixed list of decisions rather than about whatever happened to be
 * exported from this module on the day it was computed.
 */
export const THRESHOLDS = {
  measurement: {
    INTERSECTION_THRESHOLD,
    MIN_MEANINGFUL_EXPOSURE_MS,
    INACTIVITY_WINDOW_MS,
    ACTIVITY_PING_MS,
    SCROLL_DIRECTION_MIN_DELTA_PX,
  },
  observation: {
    SECTION_DWELL_MIN_MS,
    MIN_PASSAGES_FOR_MEDIAN,
    MIN_DIRECTION_REVERSALS,
    UNIFORM_DWELL_MAX_SPREAD,
  },
  claim: {
    MIN_ACTIVE_SESSION_MS,
    MIN_MEANINGFUL_PASSAGES,
    MIN_ROOTS_FOR_CLAIM,
    MIN_ROOTS_FOR_MODERATE,
    MIN_EVIDENCE_TYPES_FOR_MODERATE,
    MAX_EXPOSED_CLAIMS,
    MIN_ATTENTION_RATIO,
  },
} as const;
