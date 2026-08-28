/**
 * Regression guard for #106: #129 replaced `token === apiKey` with a
 * constant-time compare (timingSafeTokenMatch). Overwatch mutated that merged
 * branch and put the plain-equality line back, and 9 of 9 functional tests
 * stayed green - the two versions behave identically except for timing,
 * which no functional assertion can observe.
 *
 * Two rounds of textual bug-hunting both got beaten: a fixed-substring match
 * fell to a rename (token/apiKey -> supplied/expected), and a windowed
 * shape-match (v2) fell to padding the compare 800+ characters away from the
 * nearest token/apiKey mention. Any fixed window loses to enough padding,
 * and a window wide enough to resist padding swallows the whole file and
 * false-positives. That is structural, not a tuning problem.
 *
 * So the primary control here is inverted: instead of hunting for the
 * infinite set of ways to reintroduce a plain-equality compare, it asserts
 * the fix is present. The #129/#106 regression is defined by one fact: the
 * known Runway auth routes stop calling timingSafeTokenMatch. That fact
 * can't be padded, renamed, or whitespaced away, because the attack has to
 * delete the call to introduce the compare. This checks the call site, not
 * the import - a bypass can leave the import line untouched.
 *
 * Round 3: a text-matching call-site check (`\btimingSafeTokenMatch\s*\(`)
 * is itself beatable by the exact regression this ticket exists to catch -
 * comment out the real call and drop a padded plain-equality compare next
 * to it, and the regex still "counts" the call because it matches text, not
 * code. The call-site check is now an AST walk via the TypeScript compiler
 * API (parsed with the strict TS parser, so a commented-out or
 * string-literal call is not a node in the tree and does not count),
 * scoped to the two KNOWN_AUTH_ROUTES files only. It is not extended to the
 * broad sweep below on purpose - see the scope-limits note.
 *
 * The v2 shape-match sweep is kept below as a broad secondary net over the
 * wider `src/app/api` tree (routes with no known auth helper yet, future
 * files, etc). It is not the primary control.
 *
 * #108: the call-site check above proves the call EXISTS in the syntax
 * tree. It does not prove the call is REACHED - a feature flag that
 * defaults off, a staged-rollout branch, or a killswitch left on after an
 * incident can wrap the real call in a branch that never runs and fall
 * through to a plain `===` below it, and the call-site check stays green
 * because the CallExpression node is still there. Round 5's
 * `findUnguardedEqualityReturns` closed the direct-return shape of this
 * (`return supplied === expected;`) but matched on syntax position, not
 * value: it only looked at what a return statement's own expression WAS.
 * Round 6 (gate-1 QA, then confirmed live by the dispatcher against
 * gantt-generate/route.ts) showed the compare doesn't have to sit in the
 * return expression to decide the outcome - it can gate an `if` whose
 * branches return literals, get assigned to a variable that is returned
 * later, or live inside a nested function while an outer function carries
 * the unreachable branch. `findUnguardedEqualityReturns` is now a small
 * value-flow check: for every function that (directly, or through nested
 * functions inside it) calls timingSafeTokenMatch, it asks whether a plain
 * equality comparison's boolean result can reach that function's own
 * return - via direct return, variable aliasing, a ternary branch, or as
 * the test of an `if` that gates a return - rather than asking what shape
 * the return statement's text has. This is still one call's enclosing
 * function chain, not a call graph, per Overwatch's #106 gate-1 ruling.
 *
 * Round 7 (dispatcher, confirmed live against gantt-generate/route.ts): the
 * compare doesn't have to gate a `return` either - `if (a !== b) { throw
 * ... } return true;` moves the safe compare to dead code and lets a plain
 * `!==` decide the outcome via a `throw` instead. The route's try/catch
 * still rejects a bad token (a 500 instead of a 401, but still a rejection),
 * so this shape is not an authorization bypass; it is a timing-safety
 * bypass - the exact property timingSafeTokenMatch exists to guarantee gets
 * decided by a variable-time compare instead. The if-gate check now treats
 * `throw` as a terminator alongside `return`, so it follows the compare's
 * value to whichever one the branch reaches.
 *
 * Round 8: `findUnguardedEqualityReturns` still only recognizes RETURN and
 * THROW as terminators - round 6's live counter-example, a compare moved
 * into a separate helper function (`return isAllowed(token, apiKey)`),
 * matches neither, and was only caught by the WINDOW=200 broad sweep below
 * as a proximity accident (unpadded it fired; padded past 200 characters it
 * went fully green - see round 7's report). Overwatch's ruling: stop
 * enumerating shapes. `findCoOccurrenceViolations` asserts the one property
 * that has to hold regardless of shape - the supplied token and the
 * expected secret may meet at exactly one place in the program, the call to
 * timingSafeTokenMatch - by marking every alias of each value and flagging
 * any OTHER node where both appear together as binary operands or call
 * arguments. This is now the PRIMARY control for the two known routes. See
 * the scope-limits note for what "the same place" does not cover.
 *
 * Scope limits:
 * - `findCoOccurrenceViolations` COVERS: any node in a KNOWN_AUTH_ROUTES
 *   file where an identifier resolving (by name, see below) to the `token`
 *   value and an identifier resolving to the `apiKey` value appear together
 *   as the two operands of a binary expression (any operator, not just
 *   equality) or as two arguments of the same call - REGARDLESS of which
 *   function the node is in, whether that function is reachable, what
 *   terminator (if any) consumes the result, or whether the values reach
 *   the node through a return, a throw, an if-gate, a ternary, or a helper
 *   function call in the same file or a different one. It does not need to
 *   recognise the construct because it is not matching constructs.
 * - `findCoOccurrenceViolations` DOES NOT COVER two values that never
 *   SYNTACTICALLY co-occur as operands/arguments at all - e.g. both stashed
 *   as properties on a module-level object and read back and compared
 *   through a third variable that aliases neither name directly, or
 *   compared via `Object.is(...)`-style reflection that doesn't put both
 *   identifiers in the same argument list this walk inspects. This is
 *   acceptable against the threat model this ticket is named for: ordinary
 *   engineering by someone who never heard of the guard - a feature flag
 *   defaulting off, a staged rollout, a killswitch, a helper extracted
 *   during a tidy-up. None of those people are trying to keep the two
 *   values apart, which is exactly why co-occurrence works on them and
 *   would not work on someone who was. The limit travels with the control:
 *   it does not defend against deliberate evasion, only ordinary
 *   engineering that happens to reintroduce the bypass.
 * - Alias resolution is NAME-based, over the whole file, not full
 *   scope/symbol binding. A variable deliberately shadowed under the same
 *   name (e.g. a nested block redeclaring `token` for an unrelated value)
 *   would be treated as the same value. This is the same limit
 *   `findUnguardedEqualityReturns` already had for its own aliasing, now
 *   also true of the co-occurrence check.
 * - It does not resolve callee-name SHADOWING: a locally declared
 *   `function timingSafeTokenMatch(a, b) { return a === b; }` in the same
 *   file produces a CallExpression whose callee text matches the real
 *   import, so a call to the shadow is treated as the approved call.
 *   Resolving the callee identifier back to its import binding is not done
 *   here - open since round 5, not closed by this change.
 * - It does not (yet) cover a future third auth route, which would need to
 *   be added to KNOWN_AUTH_ROUTES by hand.
 * - It is scoped to the two KNOWN_AUTH_ROUTES files, same as the call-site
 *   check and `findUnguardedEqualityReturns`. It does not extend to files
 *   with no known auth helper yet or future files the way the WINDOW=200
 *   broad sweep below did - see that sweep's own remaining scope note.
 * - `findUnguardedEqualityReturns` (round 5-7) is left in place as a second
 *   layer for the known routes even though co-occurrence now covers
 *   everything it covers; it is not the primary control any more, and
 *   nothing here relies on it.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const ROOT = path.resolve(__dirname, "../../..");
const AUTH_ROOT = path.join(ROOT, "src/app/api");
const THIS_FILE = path.resolve(__filename);

// How far (in characters, on whitespace-normalized source) an equality
// operator may sit from a token/apiKey mention and still count as the same
// compare, for the broad secondary sweep below. Left at 200 deliberately -
// see the scope-limits note above for why no value of this constant is a
// real fix.
const WINDOW = 200;

// The Runway auth routes known to gate on RUNWAY_MCP_API_KEY via
// timingSafeTokenMatch. This is the primary control's coverage list.
const KNOWN_AUTH_ROUTES = [
  path.join(AUTH_ROOT, "mcp/runway/route.ts"),
  path.join(AUTH_ROOT, "runway/gantt-generate/route.ts"),
];

// Counts real CALL EXPRESSIONS to timingSafeTokenMatch by parsing the file
// with the TypeScript compiler API, not by matching text. A regex on the
// source text matches a commented-out call
// (`// timingSafeTokenMatch(token, apiKey);`) or one sitting in a string
// literal exactly as readily as a live one - a bypass that comments out the
// real call and drops in a plain-equality compare next to it stayed green
// under the old regex version of this check with a call "count" of 1. A
// comment or a string literal is not a node in the parsed AST, so walking
// the tree for actual CallExpression nodes closes that gap by construction.
// Scoped to the two KNOWN_AUTH_ROUTES files only - this does not extend to
// the broad sweep below, which stays text-based on purpose (see the
// scope-limits note at the top of this file for why).
function countTimingSafeCallExpressions(source: string, fileName: string): number {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "timingSafeTokenMatch"
    ) {
      count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

const EQUALITY_OPERATOR_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function unwrapParens(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

// Every function-like ancestor of `node`, innermost first. Round 5 used only
// the nearest one, which is why a real call sitting in a NESTED inner
// function left the outer function - the one that actually carries an
// unreachable branch and a plain-equality fallback - uninspected. Marking
// every ancestor as "guarded" closes that: the outer function's own returns
// get walked too, not just the inner function's.
function findAllEnclosingFunctions(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (isFunctionLike(current)) out.push(current);
    current = current.parent;
  }
  return out;
}

// Collects every ReturnStatement reachable from `root` without crossing into
// a nested function - if/else, try/catch, switch, and loop bodies are
// followed, but a nested function/arrow declared inside `root` is not
// descended into, since a return inside IT belongs to a different function's
// contract.
function collectReturnsInFunctionScope(root: ts.Node): ts.ReturnStatement[] {
  const out: ts.ReturnStatement[] = [];
  const visit = (node: ts.Node, isRoot: boolean) => {
    if (!isRoot && isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) out.push(node);
    ts.forEachChild(node, (child) => visit(child, false));
  };
  visit(root, true);
  return out;
}

// Same traversal rule as collectReturnsInFunctionScope, for IfStatement
// nodes instead of returns.
function collectIfStatementsInFunctionScope(root: ts.Node): ts.IfStatement[] {
  const out: ts.IfStatement[] = [];
  const visit = (node: ts.Node, isRoot: boolean) => {
    if (!isRoot && isFunctionLike(node)) return;
    if (ts.isIfStatement(node)) out.push(node);
    ts.forEachChild(node, (child) => visit(child, false));
  };
  visit(root, true);
  return out;
}

// True if a Return OR Throw statement exists anywhere under `node` without
// crossing into a nested function - used to ask "does this if-branch decide
// the function's OUTCOME" without caring whether that outcome is expressed
// as an allow (`return`) or a deny (`throw`). Round 7: the dispatcher proved
// a real route where the equality compare gated a `throw` instead of a
// `return` (`if (suppliedAlias !== expectedAlias) { throw ... } return true;`).
// The route's own try/catch turns that throw into a 500, so the allow/deny
// ANSWER stays correct - but the DECISION was made by a variable-time `!==`
// instead of timingSafeTokenMatch, which is the entire reason that function
// exists. Treating throw as a terminator alongside return closes this
// without adding a throw-specific rule: both are just "this branch decides
// the function's outcome."
function statementContainsTerminator(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node, isRoot: boolean) => {
    if (found) return;
    if (!isRoot && isFunctionLike(child)) return;
    if (ts.isReturnStatement(child) || ts.isThrowStatement(child)) {
      found = true;
      return;
    }
    ts.forEachChild(child, (grandchild) => visit(grandchild, false));
  };
  visit(node, true);
  return found;
}

function isEqualityBinary(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && EQUALITY_OPERATOR_KINDS.has(node.operatorToken.kind);
}

// Resolves a plain identifier to its nearest `const`/`let` declaration's
// initializer within `scope`, by name. Not full scope/symbol binding - a
// heuristic good enough to follow the ordinary "alias a value, return the
// alias" shapes this ticket is about, called out as a scope limit above for
// the deliberately-shadowed-name edge case it does not handle.
function findVariableInitializer(scope: ts.Node, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node, isRoot: boolean) => {
    if (found) return;
    if (!isRoot && isFunctionLike(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, (child) => visit(child, false));
  };
  visit(scope, true);
  return found;
}

// True if `expr`'s value can resolve to a plain equality comparison's
// boolean result - directly, through a chain of `const x = <expr>`
// aliasing, or through a ternary that picks between equality-derived
// branches. This is the value-flow step that lets the check follow WHERE
// the compare's result goes instead of matching WHERE the compare sits in
// the syntax tree.
function isEqualityDerived(expr: ts.Expression, scope: ts.Node, seen: Set<string> = new Set()): boolean {
  const unwrapped = unwrapParens(expr);
  if (isEqualityBinary(unwrapped)) return true;
  if (ts.isIdentifier(unwrapped)) {
    if (seen.has(unwrapped.text)) return false;
    seen.add(unwrapped.text);
    const initializer = findVariableInitializer(scope, unwrapped.text);
    if (!initializer) return false;
    return isEqualityDerived(initializer, scope, seen);
  }
  if (ts.isConditionalExpression(unwrapped)) {
    return (
      isEqualityDerived(unwrapped.whenTrue, scope, seen) || isEqualityDerived(unwrapped.whenFalse, scope, seen)
    );
  }
  return false;
}

/**
 * #108: token-compare-guard.test.ts proved a call to timingSafeTokenMatch
 * EXISTS in a file's syntax tree. It did not prove that call is REACHED. An
 * ordinary feature flag, a staged rollout, or a killswitch left on after an
 * incident can wrap the real call in a branch that never runs
 * (`if (USE_TIMING_SAFE) { return timingSafeTokenMatch(...) }`) and fall
 * through to a plain `===` compare below it - the call-site check above
 * still finds its CallExpression node and stays green while the constant-
 * time compare is fully bypassed at runtime.
 *
 * Round 6: the round-5 version of this check only looked at whether a
 * RETURN STATEMENT'S OWN EXPRESSION was a plain equality comparison. Gate-1
 * QA showed, and the dispatcher confirmed live against a real route file,
 * that the compare doesn't have to be the return expression to decide the
 * outcome - it can gate an `if` whose branches return, feed a variable that
 * gets returned later, or live in a nested function while an outer function
 * carries the unreachable branch. This version marks every function that
 * ENCLOSES the real call (not just the nearest one) as guarded, then for
 * each such function asks whether a plain equality comparison's boolean
 * result can reach that function's own return, via direct return, variable
 * aliasing, a ternary branch, or an `if` that gates a return in either
 * branch. It follows the VALUE, not the syntax position, which is what lets
 * it survive the flag/alias/nesting/if-gate shapes without needing a
 * separate rule per shape. Still one call's enclosing-function chain, not a
 * call graph, per Overwatch's #106 gate-1 ruling.
 *
 * Round 7: the dispatcher proved a real route where the compare gated a
 * `throw` instead of a `return` - the safe compare stayed dead code and a
 * plain `!==` decided whether the request was rejected. The if-gate check
 * now treats `throw` as a terminator alongside `return` (see
 * `statementContainsTerminator`), so it follows the compare's value to
 * whichever terminator - allow or deny - the branch actually reaches,
 * instead of only recognizing `return`-shaped decisions. See the
 * scope-limits note at the top of this file for what it still does not
 * cover.
 */
function findUnguardedEqualityReturns(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const guardedFunctions = new Set<ts.Node>();
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "timingSafeTokenMatch"
    ) {
      for (const enclosing of findAllEnclosingFunctions(node)) guardedFunctions.add(enclosing);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const offenders: string[] = [];
  for (const fn of guardedFunctions) {
    for (const ret of collectReturnsInFunctionScope(fn)) {
      if (!ret.expression) continue;
      if (isEqualityDerived(ret.expression, fn)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(ret.getStart(sourceFile));
        offenders.push(`${fileName}:${line + 1}: ${ret.getText(sourceFile).trim()}`);
      }
    }
    for (const ifStmt of collectIfStatementsInFunctionScope(fn)) {
      if (!isEqualityDerived(ifStmt.expression, fn)) continue;
      const gatesTerminator =
        statementContainsTerminator(ifStmt.thenStatement) ||
        (ifStmt.elseStatement !== undefined && statementContainsTerminator(ifStmt.elseStatement));
      if (gatesTerminator) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(ifStmt.getStart(sourceFile));
        offenders.push(
          `${fileName}:${line + 1}: plain-equality compare gates a return or throw: ${ifStmt.expression.getText(sourceFile).trim()}`,
        );
      }
    }
  }
  return offenders;
}

// Resolves the set of identifier NAMES that are provably the same value as
// `seedName` (e.g. "token"), by name-based alias resolution over the WHOLE
// file: `seedName` itself, plus any `const`/`let` declaration whose
// initializer is (or, through a ternary, may be) a bare identifier already
// in the set. Runs to a fixed point so a chain of aliases (`const a = token;
// const b = a;`) resolves fully. Deliberately not scoped to one function or
// one function's enclosing chain - round 8's property does not care which
// function a co-occurrence happens in, only whether it happens at all.
function resolveAliasNames(sourceFile: ts.SourceFile, seedName: string): Set<string> {
  const tainted = new Set<string>([seedName]);
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        !tainted.has(node.name.text)
      ) {
        const init = unwrapParens(node.initializer);
        const candidates = ts.isConditionalExpression(init)
          ? [unwrapParens(init.whenTrue), unwrapParens(init.whenFalse)]
          : [init];
        if (candidates.some((c) => ts.isIdentifier(c) && tainted.has(c.text))) {
          tainted.add(node.name.text);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return tainted;
}

/**
 * Round 8 (#108): seven rounds of finding a new shape that reaches a plain
 * compare (feature flag, alias, if-gate, throw-gate, nested function) and
 * writing a rule for that one shape never converged, because the FORBIDDEN
 * set is infinite - there is always a construct nobody wrote a rule for yet
 * (round 7's own live counter-example: a helper function extracted during a
 * tidy-up, `return isAllowed(token, apiKey)`, caught nothing in
 * `findUnguardedEqualityReturns` at all, and was only caught by the
 * WINDOW=200 broad sweep as a proximity accident - unpadded it worked, and
 * padded past 200 characters it went fully green). Overwatch's ruling that
 * ends the lineage: the PERMITTED set has exactly one entry. The supplied
 * token and the expected secret may meet at exactly one place in the
 * program, and that place is a call to timingSafeTokenMatch. Only the
 * reject direction can ever be complete, because it doesn't enumerate
 * constructs - it marks every identifier that IS the token value (or a
 * name-based alias of it) and every identifier that IS the apiKey value (or
 * a name-based alias of it), then walks the file for any node where one of
 * each appears together as the two operands of a binary expression or as
 * two arguments of the same call, and flags every such node that is not the
 * approved timingSafeTokenMatch call. It does not need to recognise a
 * feature flag, a throw, a helper function, or nesting, because it is not
 * looking for any of those - it is looking for the one fact that has to be
 * true regardless of how the surrounding code is shaped: the two values
 * were in the same place. See the scope-limits note at the top of this file
 * for what "the same place" does not cover.
 */
function findCoOccurrenceViolations(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const tokenNames = resolveAliasNames(sourceFile, "token");
  const apiKeyNames = resolveAliasNames(sourceFile, "apiKey");

  const classify = (expr: ts.Expression): "token" | "apiKey" | null => {
    const unwrapped = unwrapParens(expr);
    if (!ts.isIdentifier(unwrapped)) return null;
    if (tokenNames.has(unwrapped.text)) return "token";
    if (apiKeyNames.has(unwrapped.text)) return "apiKey";
    return null;
  };

  const isApprovedCall = (node: ts.CallExpression): boolean =>
    ts.isIdentifier(node.expression) && node.expression.text === "timingSafeTokenMatch";

  const offenders: string[] = [];
  const record = (node: ts.Node) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    offenders.push(
      `${fileName}:${line + 1}: token and apiKey co-occur outside timingSafeTokenMatch: ${node.getText(sourceFile).trim()}`,
    );
  };

  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node)) {
      const left = classify(node.left);
      const right = classify(node.right);
      if (left && right && left !== right) record(node);
    } else if (ts.isCallExpression(node) && !isApprovedCall(node)) {
      const classes = new Set(node.arguments.map(classify).filter((c): c is "token" | "apiKey" => c !== null));
      if (classes.has("token") && classes.has("apiKey")) record(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return offenders;
}

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (
      entry.isFile() &&
      (full.endsWith(".ts") || full.endsWith(".tsx")) &&
      !full.endsWith(".test.ts") &&
      !full.endsWith(".test.tsx") &&
      path.resolve(full) !== THIS_FILE
    ) {
      results.push(full);
    }
  }
  return results;
}

/**
 * True if `source` contains a `==`/`===` operator with both a `token` and
 * an `apiKey` mention (bare identifier, or `process.env.*`) within WINDOW
 * characters of it on whitespace-normalized source. Shape-based on purpose:
 * it does not require the identifiers to sit directly next to the operator,
 * so it still catches a compare fed by freshly-aliased variables.
 */
function hasTokenEqualityShape(source: string): boolean {
  const normalized = source.replace(/\s+/g, " ");
  const opPattern = /(?<![=!])={2,3}(?!=)/g;
  let match: RegExpExecArray | null;
  while ((match = opPattern.exec(normalized)) !== null) {
    const start = Math.max(0, match.index - WINDOW);
    const end = Math.min(normalized.length, match.index + match[0].length + WINDOW);
    const windowText = normalized.slice(start, end);
    const hasToken = /\btoken\b/.test(windowText);
    const hasApiKey = /\bapiKey\b/.test(windowText) || /process\.env\b/.test(windowText);
    if (hasToken && hasApiKey) {
      return true;
    }
  }
  return false;
}

const allFiles = collectSourceFiles(AUTH_ROOT);

describe("token-compare guard: known auth routes must call timingSafeTokenMatch", () => {
  it.each(KNOWN_AUTH_ROUTES)("%s contains at least one real timingSafeTokenMatch call expression", (file) => {
    const content = fs.readFileSync(file, "utf-8");
    expect(countTimingSafeCallExpressions(content, file)).toBeGreaterThanOrEqual(1);
  });

  it("does not count a commented-out call as a real call expression", () => {
    const commentedOut = `
      // timingSafeTokenMatch(token, apiKey); disabled for canary rollout
      function validateAuth(token, apiKey) {
        return token === apiKey;
      }
    `;
    expect(countTimingSafeCallExpressions(commentedOut, "fixture.ts")).toBe(0);
  });

  it("does not count a call inside a string literal as a real call expression", () => {
    const inString = `
      const note = "call timingSafeTokenMatch(token, apiKey) here later";
      function validateAuth(token, apiKey) {
        return token === apiKey;
      }
    `;
    expect(countTimingSafeCallExpressions(inString, "fixture.ts")).toBe(0);
  });

  it("still counts the call after a legitimate reformat (multi-line args, added parens)", () => {
    const reformatted = `
      function validateAuth(token, apiKey) {
        return (
          timingSafeTokenMatch(
            token,
            apiKey,
          )
        );
      }
    `;
    expect(countTimingSafeCallExpressions(reformatted, "fixture.ts")).toBe(1);
  });
});

describe("token-compare guard: the guarded function has no reachable plain-equality return (#108)", () => {
  it.each(KNOWN_AUTH_ROUTES)(
    "%s's guarded function has no return path that resolves to a plain equality compare",
    (file) => {
      const content = fs.readFileSync(file, "utf-8");
      const offenders = findUnguardedEqualityReturns(content, file);
      expect(
        offenders,
        `Plain-equality return found in the guarded function:\n${offenders.join("\n")}`,
      ).toHaveLength(0);
    },
  );

  it("flags a feature-flag bypass where the plain-equality return is reachable when the flag is off", () => {
    // The #108 attack: the real call still exists in the syntax tree (the
    // call-site check above stays green), but USE_TIMING_SAFE is never
    // true, so the reachable return is the plain compare below it.
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      const USE_TIMING_SAFE = false;
      function validateAuth(token, apiKey) {
        if (USE_TIMING_SAFE) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const supplied = token;
        const expected = apiKey;
        return supplied === expected;
      }
    `;
    expect(findUnguardedEqualityReturns(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags an if (false) bypass with aliasing and padding between the two returns", () => {
    // The exact repro described in #108: wrap the real return in
    // `if (false)`, alias token/apiKey below it, pad ~10 filler lines to
    // clear the broad sweep's WINDOW, and return a plain `===`.
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const suppliedAlias = token;
        const expectedAlias = apiKey;
        const filler1 = 1;
        const filler2 = 2;
        const filler3 = 3;
        const filler4 = 4;
        const filler5 = 5;
        const filler6 = 6;
        const filler7 = 7;
        const filler8 = 8;
        const filler9 = 9;
        const filler10 = 10;
        return suppliedAlias === expectedAlias;
      }
    `;
    expect(findUnguardedEqualityReturns(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags a plain-equality compare used as an if-condition that gates literal returns (round 6)", () => {
    // The shape QA found and the dispatcher reproduced live at
    // gantt-generate/route.ts: the compare doesn't sit in the return
    // expression at all, it sits in the if-CONDITION, and the branches
    // return literal true/false. Round 5's return-expression-shape check
    // missed this entirely.
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const suppliedAlias = token;
        const expectedAlias = apiKey;
        if (suppliedAlias === expectedAlias) {
          return true;
        }
        return false;
      }
    `;
    expect(findUnguardedEqualityReturns(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags a plain-equality compare assigned to a variable that is returned later (round 6)", () => {
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const ok = token === apiKey;
        return ok;
      }
    `;
    expect(findUnguardedEqualityReturns(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags an outer function's plain-equality return when the real call lives in a nested inner function (round 6)", () => {
    // Round 5's findEnclosingFunction attributed the call to the INNER
    // function only, so the outer function - the one actually carrying the
    // unreachable branch and the plain-equality fallback - was never
    // inspected. Marking every enclosing function, not just the nearest,
    // closes this.
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        function callRealCompare() {
          return timingSafeTokenMatch(token, apiKey);
        }
        if (false) {
          return callRealCompare();
        }
        return token === apiKey;
      }
    `;
    expect(findUnguardedEqualityReturns(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags a plain-equality compare used as an if-condition that gates a throw instead of a return (round 7)", () => {
    // The shape the dispatcher proved live against gantt-generate/route.ts:
    // the compare doesn't gate a `return` at all, it gates a `throw` in the
    // mismatch branch, and the match branch falls through to an unconditional
    // `return true`. The route's try/catch still rejects a bad token, so the
    // observable allow/deny answer is correct - but the decision was made by
    // a variable-time `!==` instead of timingSafeTokenMatch, which is the
    // bypass this check exists to catch.
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const suppliedAlias = token;
        const expectedAlias = apiKey;
        if (suppliedAlias !== expectedAlias) {
          throw new Error("Unauthorized");
        }
        return true;
      }
    `;
    expect(findUnguardedEqualityReturns(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("does not flag a throw gated by a non-equality condition", () => {
    // No-false-positive check for the round-7 terminator generalization: an
    // ordinary guard clause like a missing-header check throws too, but its
    // condition is not an equality comparison, so it must not be flagged
    // just because the enclosing function also calls timingSafeTokenMatch.
    const clean = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (!token) {
          throw new Error("missing token");
        }
        return timingSafeTokenMatch(token, apiKey);
      }
    `;
    expect(findUnguardedEqualityReturns(clean, "fixture.ts")).toHaveLength(0);
  });

  it("does not flag the real call through a trivial intermediate variable and multi-line formatting", () => {
    // No-false-positive check: this is not text-matching on the exact
    // one-liner `return timingSafeTokenMatch(token, apiKey);` - the call can
    // be reformatted or its result assigned to a variable first, and the
    // check must still see zero plain-equality RETURNS (it is not scoring
    // the call site itself - that is the job of the check above).
    const reformatted = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        const result = timingSafeTokenMatch(
          token,
          apiKey,
        );
        return (
          result
        );
      }
    `;
    expect(findUnguardedEqualityReturns(reformatted, "fixture.ts")).toHaveLength(0);
  });
});

describe("token-compare guard: token and apiKey may only co-occur inside timingSafeTokenMatch (#108 round 8)", () => {
  it.each(KNOWN_AUTH_ROUTES)("%s has no co-occurrence outside the approved timingSafeTokenMatch call", (file) => {
    const content = fs.readFileSync(file, "utf-8");
    const offenders = findCoOccurrenceViolations(content, file);
    expect(offenders, `Co-occurrence found outside the approved call:\n${offenders.join("\n")}`).toHaveLength(0);
  });

  it("flags an if (false) bypass with aliasing and padding (shape 1)", () => {
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const suppliedAlias = token;
        const expectedAlias = apiKey;
        const filler1 = 1;
        const filler2 = 2;
        const filler3 = 3;
        const filler4 = 4;
        const filler5 = 5;
        const filler6 = 6;
        const filler7 = 7;
        const filler8 = 8;
        const filler9 = 9;
        const filler10 = 10;
        return suppliedAlias === expectedAlias;
      }
    `;
    expect(findCoOccurrenceViolations(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags a plain-equality compare used as an if-condition gating literal returns (shape 2)", () => {
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const suppliedAlias = token;
        const expectedAlias = apiKey;
        if (suppliedAlias === expectedAlias) {
          return true;
        }
        return false;
      }
    `;
    expect(findCoOccurrenceViolations(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags a plain-equality compare assigned to a variable returned later (shape 3)", () => {
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const ok = token === apiKey;
        return ok;
      }
    `;
    expect(findCoOccurrenceViolations(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags an outer function's plain-equality return when the real call lives in a nested inner function (shape 4)", () => {
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        function callRealCompare() {
          return timingSafeTokenMatch(token, apiKey);
        }
        if (false) {
          return callRealCompare();
        }
        return token === apiKey;
      }
    `;
    expect(findCoOccurrenceViolations(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags a plain-equality compare gating a throw instead of a return, padded (shape 5)", () => {
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const suppliedAlias = token;
        const expectedAlias = apiKey;
        if (suppliedAlias !== expectedAlias) {
          throw new Error("Unauthorized");
        }
        return true;
      }
    `;
    expect(findCoOccurrenceViolations(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags a plain-equality compare assigned via a later `=` and read by an unrelated if (shape 6, outer-scope assignment)", () => {
    // Previously open ("does NOT follow a plain-equality result that is
    // assigned to an outer-scope variable via a later `=`"): the boolean
    // RESULT is what findUnguardedEqualityReturns follows, and it only
    // follows `const`/`let` initializers, not reassignment. Co-occurrence
    // doesn't care what happens to the boolean result at all - it catches
    // `token === apiKey` at the moment token and apiKey meet, regardless of
    // where the result goes afterward.
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        let authorized;
        authorized = token === apiKey;
        if (!authorized) {
          throw new Error("Unauthorized");
        }
        return true;
      }
    `;
    expect(findCoOccurrenceViolations(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags a call to a separate helper function that receives both values, unpadded and padded (shape 7, cross-file/helper)", () => {
    // Previously open ("DOES NOT COVER a call graph spanning multiple
    // functions or files"). The guard never looks inside isAllowed, or
    // needs to find it, or cares what file it's in - the CALL SITE
    // `isAllowed(token, apiKey)` is itself the violation, since it's a node
    // where token and apiKey co-occur as call arguments outside the
    // approved call.
    const bypassUnpadded = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        return isAllowed(token, apiKey);
      }
      function isAllowed(supplied, expected) {
        return supplied === expected;
      }
    `;
    expect(findCoOccurrenceViolations(bypassUnpadded, "fixture.ts")).toHaveLength(1);

    const filler = Array.from({ length: 70 }, (_, i) => `        const pad${i} = "x${i}";`).join("\n");
    const bypassPadded = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
${filler}
        return isAllowed(token, apiKey);
      }
      function isAllowed(supplied, expected) {
${filler}
        return supplied === expected;
      }
    `;
    expect(findCoOccurrenceViolations(bypassPadded, "fixture.ts")).toHaveLength(1);
  });

  it("does not flag token used alone with no apiKey present", () => {
    const clean = `
      function logRequest(token) {
        console.log("saw token of length", token.length);
      }
    `;
    expect(findCoOccurrenceViolations(clean, "fixture.ts")).toHaveLength(0);
  });

  it("does not flag apiKey used alone with no token present", () => {
    const clean = `
      function checkConfigured(apiKey) {
        return apiKey !== undefined;
      }
    `;
    expect(findCoOccurrenceViolations(clean, "fixture.ts")).toHaveLength(0);
  });

  it("does not flag token and apiKey used separately in unrelated operations that never co-occur", () => {
    const clean = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        const tokenLen = token.length;
        const hasKey = apiKey !== undefined;
        if (tokenLen === 0 || !hasKey) {
          throw new Error("bad input");
        }
        return timingSafeTokenMatch(token, apiKey);
      }
    `;
    expect(findCoOccurrenceViolations(clean, "fixture.ts")).toHaveLength(0);
  });

  it("does not flag the real call through a trivial intermediate variable and multi-line formatting", () => {
    const reformatted = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        const result = timingSafeTokenMatch(
          token,
          apiKey,
        );
        return (
          result
        );
      }
    `;
    expect(findCoOccurrenceViolations(reformatted, "fixture.ts")).toHaveLength(0);
  });
});

// Round 8, step 2 of 3 (#108): DISABLED to prove `findCoOccurrenceViolations`
// does not depend on this relic - round 7's live counter-example (a
// plain-equality compare moved into a separate helper function,
// `return isAllowed(token, apiKey)`) was caught by this broad sweep only as
// a proximity ACCIDENT: unpadded it fired, padded past WINDOW=200
// characters it went fully green. An accident this check doesn't understand
// is not provably a subset of the new, better-reasoned co-occurrence check
// just because the new check is better reasoned - it has to be shown, not
// assumed. With this block skipped, all eight #108 bypass shapes (fixture
// AND real-route-file mutations, see the round 8 report in the #108
// thread) were re-verified RED on `findCoOccurrenceViolations` alone, with
// this relic provably contributing nothing (0 of its assertions execute
// while skipped). Deleted, once that was proven, in the next commit.
describe.skip("token-compare guard: no plain-equality token compare in Runway API routes (broad net)", () => {
  it("scans at least 32 API route source files", () => {
    expect(allFiles.length).toBeGreaterThanOrEqual(32);
  });

  it("no API route source contains an equality-shaped token/apiKey compare", () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      const content = fs.readFileSync(file, "utf-8");
      if (hasTokenEqualityShape(content)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `Equality-shaped token/apiKey compare found:\n${offenders.join("\n")}`,
    ).toHaveLength(0);
  });

  describe("positive controls: the detector actually fires on known bypasses", () => {
    it("flags the original literal compare (token === apiKey)", () => {
      const bypass = `
        function validateAuth(token, apiKey) {
          return token === apiKey;
        }
      `;
      expect(hasTokenEqualityShape(bypass)).toBe(true);
    });

    it("flags the scout's renamed-alias bypass that beat the first version of this guard", () => {
      // Exact shape QA reported live at 1029edd9a436dd9f636b26f033ce84a3916b3ead:
      // rename token/apiKey to supplied/expected immediately before the
      // compare, and split `==` onto its own line. The substring-matching
      // guard stayed green against this. This one must not.
      const bypass = `
        function validateAuth(request) {
          const apiKey = process.env.RUNWAY_MCP_API_KEY;
          const token = authHeader.slice(7);
          const supplied = token;
          const expected = apiKey;
          return supplied
            ==
            expected;
        }
      `;
      expect(hasTokenEqualityShape(bypass)).toBe(true);
    });

    it("does not flag the real, constant-time compare shape", () => {
      // A fixture string, not a read of a live route file: the live route
      // is covered by the sweep above, and a control that reads the same
      // file it is meant to control moves in lockstep with it (see #106
      // bounce 2, lines 130-138 of the prior version) - it is not a control.
      const safe = `
        import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";

        function validateAuth(request) {
          const apiKey = process.env.RUNWAY_MCP_API_KEY;
          const authHeader = request.headers.get("authorization");
          const token = authHeader.slice(7);
          return timingSafeTokenMatch(token, apiKey);
        }
      `;
      expect(hasTokenEqualityShape(safe)).toBe(false);
    });
  });
});
