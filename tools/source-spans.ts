/**
 * Maps every rule id to the lines of source that implement it (spec v0.2 §41).
 *
 * §41 asks the mirror to show a reader the rule behind a claim. Naming the file is too weak to be
 * evidence — `claims.ts` is four hundred lines and the reader has been asked to check one rule —
 * and hardcoding line numbers rots the first time anyone adds a comment. GitHub's `#:~:text=`
 * fragments do not survive the virtualized blob view, so text anchors are out too.
 *
 * So the spans are derived from the syntax tree and committed, and `test/identity.test.ts`
 * regenerates them in memory and demands an exact match. Editing a rule without regenerating
 * fails the build; regenerating produces a diff that says precisely which rule moved.
 *
 * The compiler API rather than a regex, for the same reason the privacy guard uses it: these
 * files talk about their own rule ids in prose, and a regex would happily anchor a reader's audit
 * link to a comment.
 *
 * This module only computes. The write lives in `generate-source-spans.ts`, because a library
 * that rewrote the committed file when the test imported it would make the test compare the
 * generator against itself.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface SourceSpan {
  file: string;
  startLine: number;
  endLine: number;
}

const CLAIMS_FILE = "src/claims.ts";
const OBSERVATIONS_FILE = "src/observations.ts";

function parse(root: string, relativePath: string): ts.SourceFile {
  const absolute = path.join(root, relativePath);
  return ts.createSourceFile(
    absolute,
    readFileSync(absolute, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  );
}

function spanOf(source: ts.SourceFile, node: ts.Node, file: string): SourceSpan {
  return {
    file,
    startLine: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
  };
}

/**
 * Inference rules are object literals in the `inferenceRules` array. The span is the whole
 * literal, which is exactly the unit a reader is being asked to check: the requirements, the
 * ceiling, the alternatives and the distortion, together.
 */
function inferenceRuleSpans(source: ts.SourceFile): Record<string, SourceSpan> {
  const spans: Record<string, SourceSpan> = {};

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "inferenceRules" &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        const id = element.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "id" &&
            ts.isStringLiteral(property.initializer)
        );
        if (!id) continue;
        spans[(id.initializer as ts.StringLiteral).text] = spanOf(source, element, CLAIMS_FILE);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return spans;
}

/** Every rule id constructed anywhere inside `node`. */
function ruleIdsWithin(node: ts.Node): Set<string> {
  const ids = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === "observation" &&
      child.arguments.length > 0 &&
      ts.isStringLiteral(child.arguments[0])
    ) {
      ids.add((child.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return ids;
}

/**
 * Observation rules are not data — each one is a block of imperative code inside
 * `deriveObservations` that calls `observation("<ruleId>", ...)`.
 *
 * The span is the *outermost* enclosing statement that still contains only this rule. Widening
 * further would sweep in a neighbour: the passage-median rules share an
 * `if (passageDwell.length >= MIN_PASSAGES_FOR_MEDIAN)` guard, and pointing three different audit
 * links at that whole block would tell a reader checking one rule to read three. Widening as far
 * as it can is what includes the loop or conditional that decides whether the observation is made
 * at all, which is the part a reader most needs to see.
 */
function observationRuleSpans(source: ts.SourceFile): Record<string, SourceSpan> {
  const spans: Record<string, SourceSpan> = {};

  const derive = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "deriveObservations"
  );
  if (!derive?.body) throw new Error("deriveObservations not found in " + OBSERVATIONS_FILE);

  const calls: ts.CallExpression[] = [];
  const collect = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "observation" &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(derive.body);

  for (const call of calls) {
    const id = (call.arguments[0] as ts.StringLiteral).text;
    let widest: ts.Node = call;
    for (let node: ts.Node = call; node !== derive.body; node = node.parent) {
      if (!ts.isStatement(node)) continue;
      const ids = ruleIdsWithin(node);
      if (ids.size !== 1) break;
      widest = node;
    }
    spans[id] = spanOf(source, widest, OBSERVATIONS_FILE);
  }

  return spans;
}

export function computeSourceSpans(root: string): Record<string, SourceSpan> {
  const spans = {
    ...inferenceRuleSpans(parse(root, CLAIMS_FILE)),
    ...observationRuleSpans(parse(root, OBSERVATIONS_FILE)),
  };
  // Sorted so the committed file has one canonical form and a diff shows only real movement.
  return Object.fromEntries(Object.entries(spans).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function renderSourceSpans(spans: Record<string, SourceSpan>): string {
  const entries = Object.entries(spans)
    .map(
      ([id, span]) =>
        `  ${JSON.stringify(id)}: { file: ${JSON.stringify(span.file)}, startLine: ${span.startLine}, endLine: ${span.endLine} },`
    )
    .join("\n");

  return `/**
 * GENERATED by \`npm run generate:source-spans\` — do not edit.
 *
 * Rule id to the lines that implement it. \`test/source-spans.test.ts\` regenerates this from the
 * syntax tree and fails on any difference, so a stale entry cannot survive a build.
 */

export interface SourceSpan {
  file: string;
  startLine: number;
  endLine: number;
}

export const SOURCE_SPANS: Record<string, SourceSpan> = {
${entries}
};
`;
}

