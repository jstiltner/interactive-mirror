/**
 * Extracts the prose inside each `<Passage>` from an essay source (spec v0.2 §34).
 *
 * The manifest records a word count per passage because §9 normalizes dwell by rendered text —
 * comparing raw seconds across a 60-word passage and a 240-word one measures the essay's layout,
 * not the reader. Those counts are authored numbers in a file the reader can open, which means
 * they can drift from the prose they claim to describe. This module exists so a test can catch
 * that drift instead of trusting the author.
 *
 * It reads the page source as text rather than rendering it, so it is a build-time/test-time
 * utility only and is never bundled into the page. Two consumers use it, in two repositories:
 *
 *   - this package, to check every manifest word count against `fixtures/passages/*.txt`;
 *   - the essay that hosts the mirror, to check that its live prose still matches those same
 *     fixtures. Editing the essay without re-cutting the fixtures fails that test.
 *
 * Both checks run through the same function, so "the number in the manifest describes the prose
 * the reader actually saw" is one claim with one implementation rather than two that can quietly
 * disagree across a repository boundary.
 */

const PASSAGE_PATTERN = /<Passage id="([^"]+)">([\s\S]*?)<\/Passage>/g;

/**
 * Strips JSX down to the words a reader actually sees. Deliberately crude: it drops tags and
 * brace expressions, which for this essay's markup leaves prose plus the odd single-letter
 * variable name. Precision beyond that would be false — the counts feed a ratio, not a total.
 *
 * Whitespace is collapsed so the result is stable under reformatting: a prettier run that rewraps
 * a paragraph must not read as a change to the prose. Idempotent, so it can be applied to an
 * already-stripped fixture as safely as to raw JSX.
 */
export function passageProse(jsx: string): string {
  return jsx
    .replace(/\{"[^"]*"\}/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(jsx: string): number {
  return passageProse(jsx)
    .split(" ")
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function extractPassageProse(source: string): Map<string, string> {
  const prose = new Map<string, string>();
  for (const [, id, body] of source.matchAll(PASSAGE_PATTERN)) {
    prose.set(id, passageProse(body));
  }
  return prose;
}

export function extractPassageWordCounts(source: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [id, prose] of extractPassageProse(source)) {
    counts.set(id, countWords(prose));
  }
  return counts;
}
