import type { ReactNode } from "react";

/**
 * Marks a stretch of prose the mirror is allowed to measure (spec v0.2 §12, §34).
 *
 * The id must appear in the passage manifest, which is where the authorial claim about what
 * kind of writing this is actually lives. This component contributes nothing but a stable
 * anchor: it renders a bare wrapper, has no behaviour, and is inert if the mirror never loads.
 *
 * Marking passages in the body rather than inferring them from headings keeps the interpretive
 * step where a reader can see it. A rule that says "you lingered on mechanisms" is only as
 * honest as the author's decision about which paragraphs are mechanisms.
 */
export default function Passage({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} data-passage={id}>
      {children}
    </div>
  );
}
