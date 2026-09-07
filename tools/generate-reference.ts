/**
 * Writes `testing/reference.json`. Run via `npm run generate:reference` after any change to the
 * thresholds, the passage manifest or the rule table.
 *
 * You do not have to remember to: `test/reference.test.ts` rebuilds the same object in memory and
 * compares it to the committed file, so a stale reference fails the build in the commit that made
 * it stale rather than in some consumer's suite later.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildReference, serializeReference } from "./reference";

const reference = buildReference();

writeFileSync(
  path.join(process.cwd(), "testing/reference.json"),
  serializeReference(reference),
  "utf8"
);

process.stdout.write(
  `reference: package ${reference.packageVersion}, ruleset ${reference.rulesetVersion}, ` +
    `manifest ${reference.passageManifestVersion}, ${reference.passages.length} passages, ` +
    `${reference.rules.length} rules\n`
);
