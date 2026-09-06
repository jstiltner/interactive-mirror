/**
 * Reading behaviour, written down (spec v0.2 §30, §32, §35).
 *
 * Every claim the Mirror makes is a function of an event log and nothing else, so the honest way
 * to describe what triggers a claim is to show the log. These are those logs: a small table of
 * spans per reader, in the same shape the instrumentation would have produced from a real visit.
 *
 * They ship with the package rather than living in `test/` because they are the readable half of
 * the rule documentation. §41 asks the panel to explain its rules in plain language; a reader who
 * wants to know what "lingered on the mechanism passages" actually means in milliseconds can read
 * `ATTENTIVE`, and a reader who wants to check that it really does produce the claim can run the
 * suite that consumes it.
 *
 * A span is a visit, not a scroll position. `section` present means the span is a passage inside
 * that section; absent means the span is the section itself. Both are emitted as enter/exit pairs,
 * because that is what `MirrorSessionStore` emits from its IntersectionObserver.
 */

import type { ReaderEvent } from "../../src/types";
import { ACTIVITY_PING_MS } from "../../src/thresholds";

export interface Span {
  /** A section id, or a passage id when `section` is set. */
  target: string;
  /** The containing section, when `target` is a passage. */
  section?: string;
  from: number;
  to: number;
}

export interface LogOptions {
  /** First activity ping. Post-exposure logs start after the boundary, not at zero. */
  from?: number;
  /** Last activity ping. Extended to the last span exit when a span runs past it. */
  until?: number;
  /** Distinguishes ids across the two arrays of one session, which must never collide. */
  seed?: string;
  exposureState?: "pre" | "post";
  /** Events a specific test needs and no reading script should carry by default. */
  extra?: Partial<ReaderEvent>[];
}

/**
 * Turns a span table into a log, with activity pings dense enough that the reader is never idle.
 *
 * The pings are not decoration. §6 makes dwell conditional on recent interaction, so a log of
 * bare enter/exit pairs describes a reader who opened a tab and left, and would derive nothing —
 * which is a real behaviour worth testing, but not the one most of these fixtures are about.
 */
export function readingLog(spans: Span[], options: LogOptions = {}): ReaderEvent[] {
  const { from = 0, until = 0, seed, exposureState = "pre", extra = [] } = options;
  let seq = 0;
  const next = (event: Omit<ReaderEvent, "id" | "exposureState">): ReaderEvent => ({
    id: seed ? `evt_${seed}_${++seq}` : `evt_${++seq}`,
    exposureState,
    ...event,
  });

  const events: ReaderEvent[] = [];
  const last = Math.max(until, ...spans.map((span) => span.to));
  for (let t = from; t <= last; t += ACTIVITY_PING_MS) {
    events.push(next({ type: "activity", timestamp: t }));
  }
  for (const span of spans) {
    const section = span.section ?? span.target;
    const target = span.section ? span.target : undefined;
    events.push(next({ type: "section_enter", timestamp: span.from, section, target }));
    events.push(next({ type: "section_exit", timestamp: span.to, section, target }));
  }
  for (const event of extra) {
    events.push(next({ type: "activity", timestamp: 0, ...event } as ReaderEvent));
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Three minutes, unevenly spent: a full minute on Section II's archive-self-citation passage, a
 * skim through the two abstract passages in III and IV, another full minute on Section V's
 * performative-loop passage, then back to Section II.
 *
 * This is the reader `mechanism_affinity_v1` is about. Two mechanism passages sit well above the
 * dwell median while two abstract ones sit below it, and the return to a section already read
 * gives `recursive_attention_v1` its second, independent evidence root — independent because the
 * return is a different episode from the original visit, not a second reading of the same one.
 */
export const ATTENTIVE: Span[] = [
  { target: "section-ii", from: 0, to: 60_000 },
  { target: "archive-self-citation", section: "section-ii", from: 0, to: 60_000 },
  { target: "section-iii", from: 60_000, to: 80_000 },
  { target: "intuition-limits", section: "section-iii", from: 60_000, to: 80_000 },
  { target: "section-iv", from: 80_000, to: 100_000 },
  { target: "revealed-preference-limits", section: "section-iv", from: 80_000, to: 100_000 },
  { target: "section-v", from: 100_000, to: 160_000 },
  { target: "performative-loop", section: "section-v", from: 100_000, to: 160_000 },
  { target: "section-ii", from: 160_000, to: 180_000 },
];

/**
 * Twenty seconds in one section. Below every threshold in the table.
 *
 * The point of keeping this as a named fixture is §20: revealing on this session must produce the
 * "not enough evidence" state, and must keep producing it. The tempting failure is to notice that
 * the panel looks empty and to lower a threshold until it does not.
 */
export const GLANCE: Span[] = [{ target: "section-ii", from: 0, to: 20_000 }];

/**
 * A minute in Section X, timestamped after the reveal.
 *
 * §19a and §39's case. These events are real, are recorded, and are shown to the reader in their
 * own partition — and no claim exposed before them may cite them or move because of them.
 */
export const AFTER_EXPOSURE: Span[] = [{ target: "section-x", from: 200_000, to: 265_000 }];
