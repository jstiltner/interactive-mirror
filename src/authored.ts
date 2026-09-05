/**
 * Reader-facing text that is written rather than derived (spec v0.2 §16, §30 invariant 7, §40).
 *
 * Kept in its own file for the same reason claims store alternative-explanation ids instead of
 * copies: everything here is a property of the instrument, not a finding about the reader, and
 * the two must not be able to blur into each other by sitting in the same array. Nothing in this
 * file may ever be computed from behaviour.
 */

/**
 * §30 invariant 7. Unknowns come from the measuring instrument's stated boundaries, never from
 * inverse inference — "you did not open a citation, therefore you may not care about evidence" is
 * exactly the move this list exists to refuse.
 */
export const UNKNOWNS = [
  "Whether you agreed with any of this, or understood it, or already knew it.",
  "Whether the time a passage held you was interest, difficulty, or a phone call.",
  "What you were doing in the parts of this page you scrolled past.",
  "Anything about you before you opened this page, or after you close it.",
];

/**
 * §12, §40. The ways this page's own construction could have produced the behaviour it is
 * describing. These always apply, whatever the rules found, and are shown alongside the
 * distortion attached to each rule that fired.
 */
export const MEASUREMENT_DISTORTIONS = [
  "This section tells you it is measuring you. Everything you have read since is reading done by someone who knows.",
  "Only seven passages on this page are marked for measurement, and the author chose them. Time spent anywhere else cannot appear here however long it was.",
  "Reading with a keyboard, a screen reader, or a phone crosses section boundaries differently than reading with a mouse on a wide screen. None of the rules adjust for that.",
];
