/**
 * The passage manifest (spec v0.2 §12, §34).
 *
 * Every classification below is an authorial judgment about the essay, not a fact discovered
 * from any reader. "This paragraph is a mechanism" is the single most load-bearing assumption in
 * the mirror: a rule that reports "you spent longer on mechanisms than on framing" is exactly as
 * defensible as this table, and no more. That is why the manifest is versioned, lives in the
 * public source, and is quoted back to the reader in the mirror's distortion section rather than
 * hidden behind the inference it produces.
 *
 * Changing a classification is a change to what the mirror can honestly say. Bump the version
 * and expect the tests to be reviewed with it.
 */

export type PassageCategory =
  | "mechanism"
  | "formal"
  | "abstract"
  | "epistemic"
  | "example"
  | "architecture"
  | "recursive";

export interface PassageDefinition {
  id: string;
  /**
   * Reader-facing name. Not in §34's schema, but observations are sentences shown to a reader
   * and "you spent 70 seconds on archive-self-citation" is a database row, not a sentence.
   */
  label: string;
  /** DOM id of the containing section, so a passage event stays section-attributable. */
  section: string;
  /** Words of rendered prose, checked against the essay source by manifest.test.ts. */
  wordCount: number;
  categories: PassageCategory[];
  manifestVersion: string;
}

export const PASSAGE_MANIFEST_VERSION = "2026-09-04.1";

const passages: Omit<PassageDefinition, "manifestVersion">[] = [
  {
    // The k + s consolidation argument. Formal, and about the archive citing itself — which is
    // why it, and not the section around it, is what recursive_attention_v1 measures.
    id: "archive-self-citation",
    label: "the consolidation argument in Section II",
    section: "section-ii",
    wordCount: 135,
    categories: ["mechanism", "formal", "recursive"],
  },
  {
    // L(T, Q, R). Notation, but the notation is a framing device the essay explicitly declines
    // to compute with, so this counts as abstract rather than mechanism.
    id: "legibility-discussion",
    label: "the legibility notation in Section II",
    section: "section-ii",
    wordCount: 162,
    categories: ["abstract", "epistemic"],
  },
  {
    id: "intuition-limits",
    label: "the passage on intuition in Section III",
    section: "section-iii",
    wordCount: 87,
    categories: ["abstract", "epistemic"],
  },
  {
    id: "revealed-preference-limits",
    label: "the constraint-and-choice passage in Section IV",
    section: "section-iv",
    wordCount: 118,
    categories: ["abstract", "example"],
  },
  {
    // P_t → M_t → P_t+1. A distinct passage from archive-self-citation in a distinct section
    // (§12); both support recursive_attention_v1 and neither substitutes for the other.
    id: "performative-loop",
    label: "the feedback-loop passage in Section V",
    section: "section-v",
    wordCount: 143,
    categories: ["mechanism", "formal"],
  },
  {
    id: "epistemic-history-record",
    label: "the two stored-record forms in Section VII",
    section: "section-vii",
    wordCount: 154,
    categories: ["mechanism", "example"],
  },
  {
    // Post-exposure for most readers: it sits after the mirror in the document (§7). Dwell here
    // after the reveal is the §19a case — the essay's warning happening live — and is reported
    // without being allowed to strengthen anything.
    id: "memory-system-design",
    label: "the memory-system requirements in Section X",
    section: "section-x",
    wordCount: 193,
    categories: ["mechanism", "architecture"],
  },
];

export const passageManifest = {
  version: PASSAGE_MANIFEST_VERSION,
  passages: passages.map((passage) => ({
    ...passage,
    manifestVersion: PASSAGE_MANIFEST_VERSION,
  })) as readonly PassageDefinition[],
} as const;

export function passagesWithCategory(
  manifest: readonly PassageDefinition[],
  category: PassageCategory
): PassageDefinition[] {
  return manifest.filter((passage) => passage.categories.includes(category));
}
