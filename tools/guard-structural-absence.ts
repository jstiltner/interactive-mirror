/**
 * Guard A: the Mirror cannot phone home, because it does not contain the ability to (spec §45).
 *
 * The panel tells a reader that nothing leaves their browser and nothing is stored. The weak way
 * to keep that true is a runtime flag — an `analytics: false`, a `if (!enabled) return`. Flags
 * get flipped, and a reader has no way to know which way it was flipped on the build in front of
 * them. The strong way is for the capability to be absent from the source, so that the claim is
 * checkable by reading rather than by trusting.
 *
 * This walks the syntax tree of `src/` and enforces two closed lists:
 *
 *   - every global the code resolves to must be on ALLOWED_GLOBALS, and
 *   - every member it reads off a browser root must be on that root's allowlist.
 *
 * Closed rather than open on purpose. A denylist of the exfiltration APIs anyone can name today
 * would not have contained `navigator.sendBeacon` before it existed, and the next one is not
 * going to announce itself either.
 *
 * The AST rather than a grep, because `session.ts` documents its own privacy properties in prose
 * and `types.ts` names the events it refuses to record. A regex guard would fail on the
 * package's own documentation the day it was written, and a guard that has to be silenced to
 * pass is a guard that will be silenced.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Globals `src/` may resolve. Every entry is here because a specific line needs it; the list is
 * meant to be read and argued with, not extended by reflex.
 */
const ALLOWED_GLOBALS = new Set([
  // Language builtins.
  "Array",
  "Boolean",
  "Error",
  "Infinity",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "Set",
  "String",
  "Symbol",
  "WeakMap",
  "isFinite",
  "isNaN",
  "undefined",

  // The four browser APIs the instrumentation touches, and no others (§45). `performance` is the
  // only clock in the package, which is what lets a test fake time without touching production
  // code.
  "IntersectionObserver",
  "document",
  "performance",
  "window",

  // Timers. Used for the throttle and the readiness tick.
  "clearInterval",
  "clearTimeout",
  "setInterval",
  "setTimeout",

  // Types only. Erased at emit, but they still resolve to lib declarations.
  "Element",
  "HTMLDivElement",
  "IntersectionObserverEntry",
  "React",
  "ReturnType",
  "Record",
  "Partial",
  "Readonly",
  "Omit",
]);

/**
 * What may be read off each browser root. `document` is allowed to find elements and report
 * whether the tab is visible; it is not allowed to reach `cookie`. `window` may listen and report
 * scroll position; it may not reach `fetch`, `localStorage`, or `navigator`.
 */
const ALLOWED_MEMBERS: Record<string, Set<string>> = {
  window: new Set(["addEventListener", "removeEventListener", "scrollY"]),
  document: new Set([
    "addEventListener",
    "removeEventListener",
    "getElementById",
    "visibilityState",
  ]),
  performance: new Set(["now"]),
};

const BROWSER_ROOTS = new Set(["window", "document", "navigator", "globalThis", "self", "top"]);

/**
 * Names that must not appear as a member access anywhere, whatever they are read off. This is
 * redundant with the closed lists above and kept anyway: it is the part of the guard a reader can
 * check by eye, and it catches an alias — `const d = document; d.cookie` — that the root-based
 * rule would miss.
 *
 * `this.` is exempted below. `open`, `write` and `setItem` are ordinary English words, and the
 * session store keeps a private `this.open` set of currently-visible targets. A guard that forced
 * that field to be renamed would be shaping the source around the checker rather than checking it,
 * and the exemption costs nothing: a field on a class declared in this same tree is not a browser
 * capability, and reaching a real one still has to go through a global the allowlist forbids.
 */
const FORBIDDEN_MEMBERS = new Set([
  "cookie",
  "deleteDatabase",
  "fetch",
  "indexedDB",
  "localStorage",
  "open",
  "postMessage",
  "sendBeacon",
  "serviceWorker",
  "sessionStorage",
  "setItem",
  "write",
  "writeText",
]);

const FORBIDDEN_CONSTRUCTORS = new Set([
  "EventSource",
  "Function",
  "SharedWorker",
  "WebSocket",
  "Worker",
  "XMLHttpRequest",
  "eval",
]);

export interface Violation {
  file: string;
  line: number;
  message: string;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found.sort();
}

/**
 * True when the identifier resolves to something declared outside the tree being scanned — i.e. a
 * global, rather than a local, a parameter, or an import.
 *
 * Deliberately *not* "every declaration is a `lib.*.d.ts` file", which is what this was first
 * written as. `@types/node` re-declares `fetch`, `localStorage` and `navigator` (in undici's
 * `fetch.d.ts`, `storage.d.ts`, `navigator.d.ts`), so under that rule the three globals this guard
 * exists to forbid were the three it silently exempted, while `document` and `window` — declared
 * only in `lib.dom.d.ts` — were checked. The guard passed because it was looking in the wrong
 * place, which is the failure mode a privacy guard can least afford.
 *
 * Asking where the declaration is *not* avoids the whole question of which `.d.ts` a global
 * arrives through. Anything a bare identifier in `src/` resolves to that was not declared in
 * `src/` came from the ambient environment, whoever typed it.
 */
function isAmbientGlobal(symbol: ts.Symbol | undefined, srcDir: string): boolean {
  const declarations = symbol?.getDeclarations();
  if (!declarations?.length) return false;
  return declarations.every((declaration) => {
    const fileName = path.resolve(declaration.getSourceFile().fileName);
    return !fileName.startsWith(srcDir);
  });
}

/**
 * Strips the syntax that does nothing at runtime but hides the receiver from a syntactic check.
 * `(window as unknown as Record<string, unknown>)["sendBeacon"]` is `window["sendBeacon"]` once
 * the parentheses and the cast are gone, and a check that only recognised a bare identifier read
 * it as an access on an anonymous expression and said nothing.
 */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)) current = current.expression;
    else if (ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
    else return current;
  }
}

/**
 * True when an identifier is a *label* rather than a reference to a binding — the `b` in `a.b`, a
 * JSX tag, a property name, an import clause.
 *
 * The distinction between the two sides of `a.b` matters more than it looks. An earlier version
 * skipped every identifier whose parent was a property access, which meant it skipped `navigator`
 * in `navigator.userAgent` as well as `userAgent` — so a browser root not on any member allowlist
 * could be read from freely as long as the member name was one nobody had thought to forbid. Only
 * the `.name` side is a label; the receiver is a reference and gets checked.
 *
 * JSX intrinsics are excluded for the opposite reason: `div` in `<div>` resolves to a property of
 * `JSX.IntrinsicElements`, declared in `@types/react`, so it is technically ambient — but it is a
 * tag, not a capability, and listing 80 HTML element names in ALLOWED_GLOBALS would bury the four
 * entries the list exists to make visible. Capitalised tags are left in: those are components, and
 * a component arriving from outside `src/` is exactly the kind of thing worth stopping on.
 */
function isNameOfSomethingElse(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertySignature(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent)) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
  if (ts.isJsxAttribute(parent)) return true;
  if (
    (ts.isJsxOpeningElement(parent) ||
      ts.isJsxClosingElement(parent) ||
      ts.isJsxSelfClosingElement(parent)) &&
    parent.tagName === node
  ) {
    return /^[a-z]/.test(node.text);
  }
  return false;
}

export function scanForCapabilities(root: string): Violation[] {
  const srcDir = path.resolve(root, "src") + path.sep;
  const files = sourceFiles(path.join(root, "src"));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.dom.d.ts", "lib.es2022.d.ts"],
    jsx: ts.JsxEmit.ReactJSX,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
    resolveJsonModule: true,
  });
  const checker = program.getTypeChecker();
  const violations: Violation[] = [];

  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const relative = path.relative(root, file).replace(/\\/g, "/");
    const at = (node: ts.Node) =>
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

    const report = (node: ts.Node, message: string) =>
      violations.push({ file: relative, line: at(node), message });

    const visit = (node: ts.Node): void => {
      // Comments and string literals are never visited as expressions, which is the whole reason
      // this is an AST walk: the package is allowed to *talk* about the APIs it does not use.
      if (ts.isPropertyAccessExpression(node)) {
        const member = node.name.text;
        const onThis = node.expression.kind === ts.SyntaxKind.ThisKeyword;
        if (FORBIDDEN_MEMBERS.has(member) && !onThis) {
          report(node, `forbidden member access .${member}`);
        }
        if (ts.isIdentifier(node.expression)) {
          const rootName = node.expression.text;
          const allowed = ALLOWED_MEMBERS[rootName];
          if (allowed && !allowed.has(member)) {
            report(node, `${rootName}.${member} is not on the ${rootName} allowlist`);
          }
        }
      }

      // `window["fet" + "ch"]` and friends. A computed read off a browser root defeats every
      // name-based check above, so it is refused outright rather than analysed.
      if (ts.isElementAccessExpression(node)) {
        const receiver = unwrap(node.expression);
        if (ts.isIdentifier(receiver) && BROWSER_ROOTS.has(receiver.text)) {
          report(node, `computed member access on ${receiver.text}`);
        }
      }

      // The same read through an alias — `const w = window as unknown as Record<string, unknown>;
      // w["fetch"]` — is not a read off a browser *root*, so the rule above does not see it. A
      // literal key is still a name, though, and a name is still checkable.
      if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
        const key = node.argumentExpression.text;
        if (FORBIDDEN_MEMBERS.has(key) || FORBIDDEN_CONSTRUCTORS.has(key)) {
          report(node, `forbidden member access ["${key}"]`);
        }
      }

      if (ts.isIdentifier(node) && FORBIDDEN_CONSTRUCTORS.has(node.text)) {
        // `Function` as a type annotation is not a capability; `new Function(...)` is.
        const parent = node.parent;
        const isTypeRef = ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent);
        if (!isTypeRef) report(node, `forbidden reference to ${node.text}`);
      }

      if (ts.isIdentifier(node) && !isNameOfSomethingElse(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (isAmbientGlobal(symbol, srcDir) && !ALLOWED_GLOBALS.has(node.text)) {
          report(node, `global '${node.text}' is not on the allowlist`);
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(source, visit);
  }

  return violations;
}
