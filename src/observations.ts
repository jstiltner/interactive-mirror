/**
 * Observations: deterministic transformations of the event log (spec v0.2 §9, §10, §33, §35).
 *
 * Everything here is a pure function of (events, manifest, now). No DOM, no timers, no reads of
 * the session store. §35 requires that an identical event history produce identical observations,
 * which is what makes the reader-facing "what this was derived from" panel a real audit rather
 * than a plausible-looking caption: the events shown are literally the inputs, and re-running
 * this file over them reproduces the sentence.
 *
 * Two rules in this file deliberately measure the same behaviour at different granularities —
 * time in a section, and time in a passage inside that section. They are not independent
 * evidence, and the root assignment below says so (§33). Getting that wrong is the failure mode
 * the essay is about.
 */

import {
  INACTIVITY_WINDOW_MS,
  MIN_DIRECTION_REVERSALS,
  MIN_PASSAGES_FOR_MEDIAN,
  SECTION_DWELL_MIN_MS,
  UNIFORM_DWELL_MAX_SPREAD,
} from "./thresholds";
import type { PassageCategory, PassageDefinition } from "./manifest";
import type { EvidenceType, ExposureState, Observation, ReaderEvent } from "./types";

interface Interval {
  start: number;
  end: number;
}

export interface Visit {
  targetId: string;
  section: string;
  isPassage: boolean;
  /**
   * The behavioural episode this visit belongs to (§14, §33). A passage visit inherits the root
   * of the section visit containing it, so 94 seconds spent on one paragraph cannot present
   * itself as two independent findings by being counted once for the paragraph and once for the
   * section around it.
   */
  rootId: string;
  start: number;
  end: number;
  eventIds: string[];
  activeMs: number;
}

interface DeriveOptions {
  now: number;
  exposureState: ExposureState;
}

const ACTIVITY_EVENT_TYPES = new Set<ReaderEvent["type"]>([
  "activity",
  "scroll_direction_change",
  "citation_open",
  "mirror_open",
  "claim_open",
  "claim_response",
]);

// --- interval arithmetic ---------------------------------------------------------------

function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function overlap(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return merge(out);
}

function duration(intervals: Interval[]): number {
  return intervals.reduce((total, i) => total + (i.end - i.start), 0);
}

/** Periods the tab was actually in front of the reader. Visible until told otherwise. */
function visibleIntervals(events: readonly ReaderEvent[], from: number, now: number): Interval[] {
  const intervals: Interval[] = [];
  let openedAt: number | null = from;
  for (const event of events) {
    if (event.type !== "visibility_change") continue;
    const visible = event.metadata?.state === "visible";
    if (visible && openedAt === null) openedAt = event.timestamp;
    if (!visible && openedAt !== null) {
      intervals.push({ start: openedAt, end: event.timestamp });
      openedAt = null;
    }
  }
  if (openedAt !== null) intervals.push({ start: openedAt, end: now });
  return merge(intervals);
}

/**
 * Periods the reader was doing something. §6 makes dwell conditional on recent activity; this
 * reconstructs that window from the throttled pings in the log rather than from a live timer, so
 * the same history always yields the same dwell.
 */
function activeIntervals(events: readonly ReaderEvent[], from: number, now: number): Interval[] {
  const starts = [from];
  for (const event of events) {
    if (ACTIVITY_EVENT_TYPES.has(event.type)) starts.push(event.timestamp);
  }
  return merge(
    starts.map((start) => ({ start, end: Math.min(start + INACTIVITY_WINDOW_MS, now) }))
  );
}

// --- visits ----------------------------------------------------------------------------

/** Time the reader was both present and doing something: visible AND recently active (§6). */
export function attentionIntervals(events: readonly ReaderEvent[], now: number): Interval[] {
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);
  if (ordered.length === 0) return [];
  const from = ordered[0].timestamp;
  return overlap(visibleIntervals(ordered, from, now), activeIntervals(ordered, from, now));
}

export function buildVisits(events: readonly ReaderEvent[], now: number): Visit[] {
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);
  if (ordered.length === 0) return [];
  const attention = attentionIntervals(ordered, now);

  const open = new Map<string, { start: number; eventIds: string[]; section: string }>();
  const visits: Visit[] = [];
  const visitCounts = new Map<string, number>();

  const close = (targetId: string, end: number, exitEventId?: string) => {
    const entry = open.get(targetId);
    if (!entry) return;
    open.delete(targetId);
    const index = (visitCounts.get(targetId) ?? 0) + 1;
    visitCounts.set(targetId, index);
    visits.push({
      targetId,
      section: entry.section,
      isPassage: targetId !== entry.section,
      rootId: `root_${targetId}_${index}`,
      start: entry.start,
      end,
      eventIds: exitEventId ? [...entry.eventIds, exitEventId] : entry.eventIds,
      activeMs: duration(overlap(attention, [{ start: entry.start, end }])),
    });
  };

  for (const event of ordered) {
    if (event.type === "section_enter") {
      const targetId = event.target ?? event.section;
      if (!targetId || !event.section) continue;
      if (!open.has(targetId)) {
        open.set(targetId, { start: event.timestamp, eventIds: [event.id], section: event.section });
      }
    } else if (event.type === "section_exit") {
      const targetId = event.target ?? event.section;
      if (targetId) close(targetId, event.timestamp, event.id);
    }
  }
  for (const targetId of [...open.keys()]) close(targetId, now);

  visits.sort((a, b) => a.start - b.start);

  // Passages inherit the root of the section visit they happened inside.
  for (const visit of visits) {
    if (!visit.isPassage) continue;
    const parent = visits.find(
      (candidate) =>
        !candidate.isPassage &&
        candidate.targetId === visit.section &&
        candidate.start <= visit.start &&
        candidate.end >= visit.start
    );
    if (parent) visit.rootId = parent.rootId;
  }

  return visits;
}

// --- phrasing --------------------------------------------------------------------------

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

export function sectionLabel(sectionId: string): string {
  const suffix = sectionId.replace(/^section-/, "");
  return ROMAN.includes(suffix) ? `Section ${suffix.toUpperCase()}` : suffix;
}

/** §6: no false precision. Nothing here is measured to better than a few seconds. */
export function approximateSeconds(ms: number): string {
  const seconds = Math.max(5, Math.round(ms / 5000) * 5);
  if (seconds < 90) return `about ${seconds} seconds`;
  return `about ${Math.round(seconds / 30) / 2} minutes`;
}

function times(count: number): string {
  if (count === 1) return "once";
  if (count === 2) return "twice";
  return `${count} times`;
}

// --- derivation ------------------------------------------------------------------------

function observation(
  ruleId: string,
  key: string,
  statement: string,
  evidenceType: EvidenceType,
  eventIds: string[],
  rootIds: string[],
  options: DeriveOptions,
  target?: string
): Observation {
  return {
    id: `obs_${options.exposureState}_${ruleId}_${key}`,
    statement,
    evidenceEventIds: [...new Set(eventIds)],
    evidenceRootIds: [...new Set(rootIds)],
    evidenceType,
    derivedAt: options.now,
    exposureState: options.exposureState,
    ruleId,
    ...(target ? { target } : {}),
  };
}

function rootAt(visits: Visit[], timestamp: number): string | undefined {
  const containing = visits.find(
    (visit) => !visit.isPassage && visit.start <= timestamp && visit.end >= timestamp
  );
  return containing?.rootId;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function categoryMedianPerWord(
  visits: Visit[],
  manifest: readonly PassageDefinition[],
  category: PassageCategory
): number | null {
  const values = manifest
    .filter((passage) => passage.categories.includes(category))
    .map((passage) => ({
      passage,
      ms: visits
        .filter((visit) => visit.targetId === passage.id)
        .reduce((total, visit) => total + visit.activeMs, 0),
    }))
    .filter((entry) => entry.ms > 0)
    .map((entry) => entry.ms / entry.passage.wordCount);
  return values.length === 0 ? null : median(values);
}

/**
 * The one entry point. §35: `(events, manifest) => Observation[]`, with `now` supplied because a
 * reader who is still inside a section has an open visit whose length depends on when the
 * question is asked. Passing it as an argument keeps the function pure — pre-exposure
 * observations are always derived as of the exposure timestamp, never as of render time.
 */
export function deriveObservations(
  events: readonly ReaderEvent[],
  manifest: readonly PassageDefinition[],
  options: DeriveOptions
): Observation[] {
  const visits = buildVisits(events, options.now);
  const observations: Observation[] = [];

  // 1. Section dwell.
  const sectionVisits = visits.filter((visit) => !visit.isPassage);
  const sections = [...new Set(sectionVisits.map((visit) => visit.targetId))];
  for (const sectionId of sections) {
    const mine = sectionVisits.filter((visit) => visit.targetId === sectionId);
    const activeMs = mine.reduce((total, visit) => total + visit.activeMs, 0);
    if (activeMs < SECTION_DWELL_MIN_MS) continue;
    observations.push(
      observation(
        "section_dwell_v1",
        sectionId,
        `${approximateSeconds(activeMs)} of active reading in ${sectionLabel(sectionId)}.`,
        "dwell",
        mine.flatMap((visit) => visit.eventIds),
        mine.map((visit) => visit.rootId),
        options,
        sectionId
      )
    );
  }

  // 2. Passage dwell against the reader's own median (§9). Never against other readers: there
  //    are no other readers, and a cross-reader baseline would be invented.
  const passageDwell = manifest
    .map((passage) => {
      const mine = visits.filter((visit) => visit.targetId === passage.id);
      const activeMs = mine.reduce((total, visit) => total + visit.activeMs, 0);
      return { passage, visits: mine, activeMs, perWord: activeMs / passage.wordCount };
    })
    .filter((entry) => entry.activeMs > 0);

  if (passageDwell.length >= MIN_PASSAGES_FOR_MEDIAN) {
    const medianPerWord = median(passageDwell.map((entry) => entry.perWord));
    for (const entry of passageDwell) {
      if (entry.perWord <= medianPerWord) continue;
      observations.push(
        observation(
          "passage_dwell_above_median_v1",
          entry.passage.id,
          `${approximateSeconds(entry.activeMs)} on ${entry.passage.label} — longer per word than your median passage in this session.`,
          "dwell",
          entry.visits.flatMap((visit) => visit.eventIds),
          entry.visits.map((visit) => visit.rootId),
          options,
          entry.passage.id
        )
      );
    }

    // 3. The limiting evidence for mechanism_affinity_v1, derived rather than assumed absent.
    const mechanism = categoryMedianPerWord(visits, manifest, "mechanism");
    const abstract = categoryMedianPerWord(visits, manifest, "abstract");
    if (mechanism !== null && abstract !== null && abstract >= mechanism) {
      const relevant = passageDwell.filter((entry) =>
        entry.passage.categories.some((category) => category === "mechanism" || category === "abstract")
      );
      observations.push(
        observation(
          "abstract_dwell_matches_mechanism_v1",
          "session",
          "Attention per word on the essay's abstract passages was as high as on its mechanism passages.",
          "dwell",
          relevant.flatMap((entry) => entry.visits.flatMap((visit) => visit.eventIds)),
          relevant.flatMap((entry) => entry.visits.map((visit) => visit.rootId)),
          options
        )
      );
    }
  }

  // 3b. The limiting evidence for recursive_attention_v1: if everything held attention equally,
  //     a claim about one passage holding it is measuring the essay, not the reader.
  if (passageDwell.length >= MIN_PASSAGES_FOR_MEDIAN) {
    const perWord = passageDwell.map((entry) => entry.perWord);
    const spread = Math.max(...perWord) / Math.min(...perWord);
    if (spread < UNIFORM_DWELL_MAX_SPREAD) {
      observations.push(
        observation(
          "uniform_dwell_v1",
          "session",
          "Attention per word was distributed evenly across the passages measured.",
          "dwell",
          passageDwell.flatMap((entry) => entry.visits.flatMap((visit) => visit.eventIds)),
          passageDwell.flatMap((entry) => entry.visits.map((visit) => visit.rootId)),
          options
        )
      );
    }
  }

  // 4. Returns (§8). A return needs another section in between, which is what separates reading
  //    back to an argument from scrolling past its boundary twice.
  for (const sectionId of sections) {
    const mine = sectionVisits.filter((visit) => visit.targetId === sectionId);
    const returns = mine.filter((visit, index) => {
      if (index === 0) return false;
      const previous = mine[index - 1];
      return sectionVisits.some(
        (other) =>
          other.targetId !== sectionId && other.start > previous.start && other.start < visit.start
      );
    });
    if (returns.length === 0) continue;
    observations.push(
      observation(
        "section_return_count_v1",
        sectionId,
        `Returned to ${sectionLabel(sectionId)} ${times(returns.length)} after reading elsewhere.`,
        "return",
        returns.flatMap((visit) => visit.eventIds),
        returns.map((visit) => visit.rootId),
        options,
        sectionId
      )
    );
  }

  // 5. Citations.
  const citations = events.filter((event) => event.type === "citation_open");
  if (citations.length > 0) {
    observations.push(
      observation(
        "citation_open_count_v1",
        "session",
        `Opened ${citations.length === 1 ? "one reference citation" : `${citations.length} reference citations`}.`,
        "citation",
        citations.map((event) => event.id),
        citations.map((event) => rootAt(visits, event.timestamp) ?? `root_citation_${event.id}`),
        options
      )
    );
  }

  // 6. Direction reversals.
  const reversals = events.filter((event) => event.type === "scroll_direction_change");
  if (reversals.length >= MIN_DIRECTION_REVERSALS) {
    observations.push(
      observation(
        "scroll_direction_reversal_v1",
        "session",
        `Reversed reading direction ${times(reversals.length)}.`,
        "sequence",
        reversals.map((event) => event.id),
        reversals.map((event) => rootAt(visits, event.timestamp) ?? `root_reversal_${event.id}`),
        options
      )
    );
  }

  // 7. Inspecting the mirror's own claims. Post-exposure by construction: the claims do not
  //    exist before the reveal.
  const inspections = events.filter((event) => event.type === "claim_open");
  if (inspections.length > 0) {
    observations.push(
      observation(
        "claim_inspection_count_v1",
        "session",
        `Opened the derivation behind a claim ${times(inspections.length)}.`,
        "provenance",
        inspections.map((event) => event.id),
        inspections.map((event) => `root_inspection_${event.target ?? event.id}`),
        options
      )
    );
  }

  return observations;
}

export interface SessionMetrics {
  /** Time the reader was present and interacting, not time the tab was open. */
  activeMs: number;
  elapsedMs: number;
  /** Manifest passages that cleared the minimum meaningful exposure (§37). */
  meaningfulPassages: number;
  meaningfulSections: number;
}

/**
 * The sample, described honestly. Claims consult this before firing (§37) because the preferred
 * failure mode is "not enough evidence", and that can only be preferred if something is actually
 * measuring the sample rather than assuming it.
 */
export function sessionMetrics(
  events: readonly ReaderEvent[],
  manifest: readonly PassageDefinition[],
  now: number
): SessionMetrics {
  if (events.length === 0) {
    return { activeMs: 0, elapsedMs: 0, meaningfulPassages: 0, meaningfulSections: 0 };
  }
  const visits = buildVisits(events, now);
  const passageIds = new Set(manifest.map((passage) => passage.id));
  const measured = (predicate: (visit: Visit) => boolean) =>
    new Set(visits.filter((visit) => visit.activeMs > 0 && predicate(visit)).map((v) => v.targetId))
      .size;
  const first = Math.min(...events.map((event) => event.timestamp));
  return {
    activeMs: duration(attentionIntervals(events, now)),
    elapsedMs: Math.max(0, now - first),
    meaningfulPassages: measured((visit) => passageIds.has(visit.targetId)),
    meaningfulSections: measured((visit) => !visit.isPassage),
  };
}
