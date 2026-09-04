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
 * scoped to the two KNOWN_AUTH_ROUTES files only.
 *
 * A v2 windowed shape-match sweep (a broad secondary net over the wider
 * `src/app/api` tree - routes with no known auth helper yet, future files,
 * etc) lived here from round 3 through round 7. Round 8 deleted it: it only
 * ever caught round 7's helper-function-extraction shape as a proximity
 * accident (unpadded it fired, padded past its WINDOW it went fully green -
 * see the round 8 paragraph below), and disabling it and re-running every
 * known bypass shape proved `findCoOccurrenceViolations` does not depend on
 * it for any of them. Deleting it loses the wider-tree, future-file net it
 * provided; see the scope-limits note for what that costs.
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
 * THROW as terminators - the dispatcher's live counter-example after round
 * 7, a compare moved into a separate helper function
 * (`return isAllowed(token, apiKey)`), matches neither, and was only caught
 * by the (now-deleted) WINDOW=200 broad sweep as a proximity accident
 * (unpadded it fired; padded past 200 characters it went fully green).
 * Overwatch's ruling: stop enumerating shapes. `findCoOccurrenceViolations`
 * asserts the one property that has to hold regardless of shape - the supplied token and the
 * expected secret may meet at exactly one place in the program, the call to
 * timingSafeTokenMatch - by marking every alias of each value and flagging
 * any OTHER node where both appear together as binary operands or call
 * arguments. This is now the PRIMARY control for the two known routes. See
 * the scope-limits note for what "the same place" does not cover.
 *
 * Round 9 (dispatcher, real-route-proven): round 8's co-occurrence check
 * matched an operand/argument only when it WAS the bare identifier `token`
 * or `apiKey`. `isAllowed(String(token), apiKey)` defeated it -
 * `String(token)` is a CallExpression, not an Identifier, so the argument
 * matched nothing, and `findUnguardedEqualityReturns` never sees inside
 * `isAllowed` either, so both checks stayed green (28/28) on the real route
 * file. The dispatcher also invented two shapes that stayed direct-equality
 * RETURNS under a receiver or template-literal
 * (`token.localeCompare(apiKey) === 0`, `` `${token}` === `${apiKey}` ``) -
 * both were already caught by `findUnguardedEqualityReturns`, proving the
 * two checks are complementary, not that co-occurrence subsumes returns.
 * The fix generalizes co-occurrence from "IS this operand the tainted
 * identifier" to "does this operand's SUBTREE carry the tainted identifier"
 * (`subtreeCarriesTaintedName`), so a wrapped value is still the value no
 * matter how many operations wrap it, and the call-argument check now scans
 * the whole call node (callee + arguments), not just `.arguments`, so a
 * method-call receiver (`token.localeCompare(apiKey)`) is also caught as a
 * co-occurrence in its own right, not only via the other check. See the
 * scope-limits note for what taint propagation still does not cover.
 *
 * Round 10 (dispatcher): the domain stated as a claim the co-occurrence
 * check can actually make, per Overwatch's ruling that the check kept
 * growing broader without ever saying what it covered, so each new shape
 * arrived as an ambush instead of a case already decided not to handle.
 * COVERED: any expression that SYNTACTICALLY contains a tainted identifier
 * at the point it becomes an operand or argument, no matter how many
 * operations wrap it inline. NOT COVERED: a value that leaves that subtree
 * through a binding (an assignment or declaration) and is read back later -
 * the binding severs the syntactic link the walk depends on, and there is
 * no dataflow analysis here to reconnect it. The first is finite and
 * statable; "any wrapper, anywhere" is not - only the reject direction can
 * ever be complete. This is a hole in what the check can verify, not a
 * hole in auth - a correctly written route and an unguarded one are
 * indistinguishable to this check. Tracked as #110, not fixed here; pinned
 * as a test below: see "KNOWN UNCOVERED ... (refs #110)" in the
 * co-occurrence test block.
 *
 * Round 11 (dispatcher, TP/Overwatch self-bounced twice on this one):
 * `findAllGuardViolations` is the union of both checks and is now the ONLY
 * function the two real-route tests below call - "the guard reports
 * nothing" is one statable claim, independent of how many checks the guard
 * happens to be made of today. Asserting against the two checks by name
 * (round 10's fix) only proves TODAY's inventory stays green; a future
 * third check closing a gap would leave both name-based assertions green
 * and nobody told. Because the real-route tests only run through the
 * aggregator, a future check that isn't added to it protects no real route
 * and is visibly dead code in its own describe block, rather than silently
 * absent - the same failure mode #109 named for KNOWN_AUTH_ROUTES, avoided
 * here rather than relocated.
 *
 * Round 13 (#110): closes the wrap-then-bind-into-a-HELPER-CALL gap Round 10
 * named and left open - `const wrapped = String(token); ...;
 * isAllowed(wrapped, apiKey);`. `resolveWrappedBindingNames` extends the
 * tainted-name set one more step: for a `const`/`let` declaration whose
 * initializer's subtree carries an already-tainted name (via
 * `subtreeCarriesTaintedName`), the declared name joins the tainted set too,
 * run to a fixed point alongside `resolveAliasNames`'s own chain. The one
 * deliberate exclusion is the reason this was not done sooner: an
 * initializer whose own TOP-LEVEL expression is an equality comparison
 * (`const ok = token === apiKey`) is never propagated, because the bound
 * value there is the BOOLEAN RESULT of comparing the two, not the token
 * itself - `ok` is not tainted, only the receiving/wrapping shapes are.
 * Pinned as its own fixture, not left as prose only, alongside the flipped
 * tripwire below.
 *
 * This wider set is used ONLY for the call-argument branch of
 * `findCoOccurrenceViolations`, deliberately not the binary-operand branch.
 * `const t = String(token); return t === apiKey;` (no helper call, a direct
 * RETURN of the compare) stays outside this extension on purpose - that
 * exact shape is `findUnguardedEqualityReturns`'s own pinned LOAD-BEARING
 * non-redundancy proof (see the test by that name below), and #110's own
 * ticket explicitly named "the binding-WITHOUT-a-helper case" as that
 * check's load-bearing domain, not something to fold into co-occurrence.
 * The ticket's own headline shape, and the only one this round closes, is
 * the binding-WITH-a-helper case: the wrap reaches an unapproved CALL, not
 * a bare compare.
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
 * - Round 9's taint propagation (`subtreeCarriesTaintedName`) covers a
 *   wrapped value used INLINE at the co-occurrence site itself -
 *   `isAllowed(String(token), apiKey)`, `foo(token.trim(), apiKey)` - because
 *   the wrapping expression's subtree is inspected at the moment it becomes
 *   an operand/argument. Round 13 (#110) extends this past the inline case,
 *   for the CALL-ARGUMENT branch only: a variable assigned from a WRAPPED
 *   value, `const wrapped = String(token); ...; isAllowed(wrapped, apiKey);`,
 *   IS now added to the tainted-name set used at a call site, via
 *   `resolveWrappedBindingNames` - see Round 13 above for the mechanism and
 *   the one deliberate exclusion (an initializer whose own top-level
 *   expression is an equality comparison is never propagated, so a boolean
 *   RESULT of comparing token and apiKey, e.g. `const ok = token === apiKey`,
 *   is not itself treated as tainted). This closes the wrap-then-alias-then-
 *   pass-into-a-HELPER-CALL shape that was open through #110; the tripwire
 *   below is flipped, not deleted, and a new fixture pins the boolean-result
 *   exclusion. Deliberately NOT extended to the binary-operand branch: `const
 *   t = String(token); return t === apiKey;` (no helper call) stays outside
 *   this wider set on purpose, since that exact shape is
 *   `findUnguardedEqualityReturns`'s own pinned load-bearing non-redundancy
 *   proof and #110's own ticket named the binding-WITHOUT-a-helper case as
 *   that check's domain, not something to fold in here.
 * - It does not resolve callee-name SHADOWING: a locally declared
 *   `function timingSafeTokenMatch(a, b) { return a === b; }` in the same
 *   file produces a CallExpression whose callee text matches the real
 *   import, so a call to the shadow is treated as the approved call.
 *   Resolving the callee identifier back to its import binding is not done
 *   here - open since round 5, not closed by this change.
 * - It does not (yet) cover a future third auth route, which would need to
 *   be added to KNOWN_AUTH_ROUTES by hand.
 * - It is scoped to the two KNOWN_AUTH_ROUTES files, same as the call-site
 *   check and `findUnguardedEqualityReturns`. Deleting the WINDOW=200 broad
 *   sweep in this round (see above) means there is now NO net at all over
 *   files with no known auth helper yet or future files - a plain-equality
 *   token/apiKey compare introduced anywhere outside the two known routes
 *   would not be caught by anything in this file until that route is added
 *   to KNOWN_AUTH_ROUTES by hand. This is a real coverage loss from
 *   deleting the relic, accepted because the relic's wide-tree coverage was
 *   itself only ever the same defeatable text-proximity heuristic, not
 *   because the gap doesn't matter.
 * - `findUnguardedEqualityReturns` (round 5-7) is NOT redundant with
 *   co-occurrence and must not be removed. Round 10 (dispatcher, real-route-
 *   proven): `const t = String(token); return t === apiKey;` is caught ONLY
 *   by `findUnguardedEqualityReturns` (route.ts:36, "no return path that
 *   resolves to a plain equality compare") - `findCoOccurrenceViolations`
 *   stays green on it, because binding the wrapped value to `const t`
 *   before comparing breaks the inline subtree the co-occurrence walk
 *   inspects; there is no single node where both `token` and `apiKey`
 *   co-occur. What separates this shape from the ones co-occurrence does
 *   catch (e.g. round 9's `isAllowed(String(token), apiKey)`) is not the
 *   `String()` wrap - it is that the compare here is still a direct
 *   RETURN, which is exactly the shape `findUnguardedEqualityReturns`
 *   exists to catch and co-occurrence structurally cannot see once a
 *   binding sits between the wrap and the compare. The two checks remain
 *   complementary; each is load-bearing for a shape the other misses.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import {
  buildEnvTracedNames,
  extractEnvVarNames,
  isProvablyNotSecretCompare,
  isSecretShapedEnvName,
  reachesAuthSink,
  resolvedEnvVarNames,
  type EnvTrace,
} from "./env-secret-trace";

const ROOT = path.resolve(__dirname, "../../..");
const AUTH_ROOT = path.join(ROOT, "src/app/api");

// The Runway auth routes known to gate on RUNWAY_MCP_API_KEY via
// timingSafeTokenMatch. This is the primary control's coverage list.
const KNOWN_AUTH_ROUTES = [
  path.join(AUTH_ROOT, "mcp/runway/route.ts"),
  path.join(AUTH_ROOT, "runway/gantt-generate/route.ts"),
  path.join(AUTH_ROOT, "runway/gantt-embed/route.ts"),
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
// Scoped to the two KNOWN_AUTH_ROUTES files only (see the scope-limits note
// at the top of this file for what that leaves uncovered).
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

// Every equality binary expression `expr`'s value can resolve to,
// directly, through a chain of `const x = <expr>` aliasing, or through a
// ternary that picks between equality-derived branches. This is the
// value-flow step that lets the check follow WHERE the compare's result
// goes instead of matching WHERE the compare sits in the syntax tree.
// Returns the actual binary nodes, not just whether one exists, so the
// caller can judge each one against the env var discriminator below
// rather than only knowing that some equality was reached.
function collectEqualityDerivedBinaries(
  expr: ts.Expression,
  scope: ts.Node,
  seen: Set<string> = new Set(),
): ts.BinaryExpression[] {
  const unwrapped = unwrapParens(expr);
  if (isEqualityBinary(unwrapped)) return [unwrapped];
  if (ts.isIdentifier(unwrapped)) {
    if (seen.has(unwrapped.text)) return [];
    seen.add(unwrapped.text);
    const initializer = findVariableInitializer(scope, unwrapped.text);
    if (!initializer) return [];
    return collectEqualityDerivedBinaries(initializer, scope, seen);
  }
  if (ts.isConditionalExpression(unwrapped)) {
    return [
      ...collectEqualityDerivedBinaries(unwrapped.whenTrue, scope, seen),
      ...collectEqualityDerivedBinaries(unwrapped.whenFalse, scope, seen),
    ];
  }
  return [];
}

// True if `expr`'s value can resolve to a plain equality comparison's
// boolean result AND at least one of those resolved comparisons is not
// provably a non secret compare, per _R1#120. findUnguardedEqualityReturns
// asks whether an equality gated return exists in a guarded function. It
// never asked whether the equality involved the secret at all, so an
// unrelated process.env.NODE_ENV check sitting in the same function as a
// real timingSafeTokenMatch call tripped it. isProvablyNotSecretCompare
// exempts a binary only when it can positively trace a side to a non
// secret shaped env var name, never when neither side traces to any known
// env var, so a bare `token === apiKey` with no env in scope, the shape
// every earlier round of this guard was built to catch, still flags.
function isEqualityDerived(
  expr: ts.Expression,
  scope: ts.Node,
  sourceFile: ts.SourceFile,
  trace: EnvTrace,
): boolean {
  const binaries = collectEqualityDerivedBinaries(expr, scope);
  return binaries.some((binary) => !isProvablyNotSecretCompare(binary, sourceFile, trace));
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
  const trace = buildEnvTracedNames(sourceFile);
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
      if (isEqualityDerived(ret.expression, fn, sourceFile, trace)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(ret.getStart(sourceFile));
        offenders.push(`${fileName}:${line + 1}: ${ret.getText(sourceFile).trim()}`);
      }
    }
    for (const ifStmt of collectIfStatementsInFunctionScope(fn)) {
      if (!isEqualityDerived(ifStmt.expression, fn, sourceFile, trace)) continue;
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
// True if `names` contains the text of any identifier reachable from `node`
// WITHOUT going through it as a value - the taint-propagation step that lets
// the co-occurrence check follow the VALUE through a wrapping expression
// (`String(token)`, `token.trim()`, `` `${token}` ``) instead of only
// recognising a bare identifier. Round 9 (#108): the dispatcher proved
// `isAllowed(String(token), apiKey)` defeats identifier-only classification -
// `String(token)` is a CallExpression, not the identifier `token`, so the old
// `classify` (which required `ts.isIdentifier(unwrapped)`) saw no match at
// that argument at all. An expression's SUBTREE containing a tainted
// identifier means the expression still carries that value: `String(token)`,
// `token.trim()`, `token.slice(0)`, and `` `${token}` `` are all still the
// token, no matter how many operations wrap it. A PropertyAccessExpression's
// `.name` (e.g. the `token` in `someUnrelatedObject.token`) is deliberately
// NOT treated as a reference - only its `.expression` (the receiver) is
// descended into - or an unrelated object literal property named "token"
// would false-positive as if it carried the seed value.
function subtreeCarriesTaintedName(node: ts.Node, names: Set<string>): boolean {
  let found = false;
  const visit = (current: ts.Node) => {
    if (found) return;
    if (ts.isPropertyAccessExpression(current)) {
      visit(current.expression);
      return;
    }
    if (ts.isIdentifier(current) && names.has(current.text)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

// Round 13 (#110): closes the wrap-then-bind gap - `const wrapped =
// String(token); ...; isAllowed(wrapped, apiKey);`. `subtreeCarriesTaintedName`
// alone only sees a wrapped value at the co-occurrence site ITSELF; once the
// wrap is bound to a new name first, the co-occurrence walk never visits the
// wrapping expression again, only the bare `wrapped` identifier - which
// `resolveAliasNames` does not add to the tainted set, by design, since it
// only chains through a bare-identifier (or ternary-of-bare-identifier)
// initializer.
//
// This closes it with one more fixed-point pass over the file's variable
// declarations: if a declaration's initializer subtree carries an
// already-tainted name, the declared name joins the tainted set too - unless
// the initializer's value is EQUALITY-DERIVED (`const ok = token ===
// apiKey`). That exclusion is load-bearing, not incidental: `token ===
// apiKey`'s subtree DOES carry `token`, so without it this pass would taint
// `ok` itself, and `ok` is a boolean, the RESULT of comparing the two
// values, not the token. Scoped to exactly the shape this ticket names - a
// non-equality wrap or computation (`token.length`, `someHelper(token)`)
// that gets bound to a new name and read back later is still tainted by
// this pass, same as the ticket's own fixture, and remains a real, narrower
// residual not attempted here since it is outside what #110 asked for.
//
// CURRENT DESIGN (rewritten, not appended - #110 round 4; prior rounds'
// history lives in git blame, not repeated here every round):
//
// This function proves a bound: an initializer's VALUE is a boolean
// derived from comparing token and apiKey, never the raw token or apiKey
// itself, so the declared name should NOT join the tainted set. It has two
// parts, deliberately different in kind.
//
// Part 1, `unwrapTransparentValueWrappers` (below): strips every syntax
// node whose VALUE is identical to (or, for a comma expression, selected
// unchanged from) an inner expression - parens, type assertions (both
// `as boolean` and the older `<boolean>expr` bracket form - matched via
// `ts.isAssertionExpression`, the TypeScript API's own shared predicate
// for both, not two separate branches for one construct), `satisfies`
// expressions, non-null `!` postfix, and comma expressions (down to the
// rightmost operand) - looped until stable so nested combinations fully
// unwrap. Four of these are compile-time-only type annotations with zero
// runtime effect; the comma case just discards its left operands. None of
// them can ever hide or produce a value on their own.
//
// MECHANISM NOTE, round 5 (QA-found, right answer for a reason worth
// naming): the comma case does NOT verify that the discarded left operand
// is safe. `const ok = (token === apiKey, someOtherThing);` still ends up
// correctly NOT excluded (tainted) today, but not because this function
// examined `someOtherThing` and found it innocent - it gets there because
// `subtreeCarriesTaintedName`, called separately by `resolveWrappedBindingNames`
// on the ORIGINAL, un-stripped initializer, is position-blind: it scans the
// whole initializer text for a tainted identifier regardless of where in
// it that identifier sits, so it finds `token` in the discarded left
// operand independent of anything this function decided. The right answer
// and the right reason are not the same mechanism here. Both happen to
// point the same way today; do not assume this function's own exclusion
// logic is what is protecting the comma-left case, because it is not.
//
// DELIBERATE EXCLUSION, round 5 (QA raised, TP ruled): `await` on an
// expression that IS a boolean also resolves to that same boolean value at
// runtime, which satisfies this function's own transparency criterion on
// its face. Not covered anyway, on purpose: recognizing it would mean this
// checker starts having an opinion about async dataflow, which it takes no
// position on anywhere else in this file, and the transparency only holds
// because a boolean is never a thenable - a property this checker has no
// way to verify, since it has no type information anywhere (see the
// TYPE-based-inversion answer from round 3). A rule whose correctness
// depends on an operand type this checker cannot check is a worse property
// than the gap it would close. `await (token === apiKey)` stays tainted,
// pinned by its own test below rather than left to be rediscovered as a
// surprise.
//
// Part 2, the checks below: enumerate the CLOSED set of JS/TS operators
// that structurally ALWAYS produce a boolean, or exclusively recombine
// sub-results already covered by another case here - the equality
// operators (via the shared `EQUALITY_OPERATOR_KINDS` constant this whole
// file uses, not this function's to redefine), boolean literals, ternary,
// logical AND/OR/nullish-coalescing, and unary NOT. Bounded because the
// operator grammar itself is closed; the language does not grow new
// operators. PLUS one named exception: `Boolean(...)`, the single
// well-known language built-in, recognized by identifier name because
// there is exactly one of it - not a general allowance for anything that
// looks like a boolean-wrapper call. An arbitrary application helper
// (`asBoolean(...)`, `isAllowed(...)`) is NOT covered and must not become
// covered without its own, separately-justified reason; call names beyond
// `Boolean` are the open corpus this function refuses to chase, which is
// why `resolveWrappedBindingNames` and `subtreeCarriesTaintedName` also
// deliberately do not try to enumerate every way a value can be wrapped.
//
// THE BOUND, stated precisely: Part 1 is a closed set of value-transparent
// syntax (finite, grammar-fixed). Part 2 is a closed set of boolean-
// producing operators (finite, grammar-fixed) plus one named built-in
// (finite by construction - there is one `Boolean`). Together they are
// still enumeration, not proof by type or by dataflow - but enumeration
// against two closed, language-level grammars, not against an open corpus
// of application patterns. If TypeScript ever adds new boolean-producing
// or value-transparent syntax, that is a bounded, nameable gap against a
// known list. Still deliberately the more permissive OR direction at each
// ternary/logical branch, not AND: a genuinely mixed branch (`cond ? token
// : (token === apiKey)`, one side the raw value, one side a compare)
// remains excluded from tainting under this check - a narrower, separate,
// already-disclosed residual, not attempted here.
//
// Caller's responsibility, not this function's: `findCoOccurrenceViolations`
// applies this only to the call-argument branch, not the binary-operand
// branch, so `const t = String(token); return t === apiKey;` (no helper
// call) is unaffected and stays `findUnguardedEqualityReturns`'s exclusive
// domain, per #110's own scoping.
//
// Deliberately a NEW function (`unwrapTransparentValueWrappers`), not a
// widening of the shared `unwrapParens`: that helper has other call sites
// in this file belonging to OTHER, pre-existing checks
// (`collectEqualityDerivedBinaries`/`findUnguardedEqualityReturns`,
// `resolveAliasNames`'s round-8 alias chain, `findCoOccurrenceViolations`'s
// binary-operand branch) with their own established, separately-tested
// behavior. Widening what they all strip, silently, to fix this one
// function's exclusion check would be exactly the unaudited-blast-radius
// risk this whole gate exists to catch. Called from exactly one place:
// this function's own entry point. Paren-stripping falls out of the loop
// below; there is no separate `unwrapParens` call left in this function.
function unwrapTransparentValueWrappers(expr: ts.Expression): ts.Expression {
  let current: ts.Expression = expr;
  let changed = true;
  while (changed) {
    changed = false;
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      changed = true;
    } else if (ts.isAssertionExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
      changed = true;
    } else if (ts.isNonNullExpression(current)) {
      current = current.expression;
      changed = true;
    } else if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.CommaToken
    ) {
      // A comma expression's value is its rightmost operand; the left
      // operands run for side effects and are discarded. Correct for the
      // question this function asks ("what VALUE does this produce"),
      // not necessarily correct for a caller asking a different question -
      // see the CURRENT DESIGN comment above.
      current = current.right;
      changed = true;
    }
  }
  return current;
}

function isEqualityDerivedShape(expr: ts.Expression): boolean {
  const unwrapped = unwrapTransparentValueWrappers(expr);
  if (isEqualityBinary(unwrapped)) return true;
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword || unwrapped.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isConditionalExpression(unwrapped)) {
    return isEqualityDerivedShape(unwrapped.whenTrue) || isEqualityDerivedShape(unwrapped.whenFalse);
  }
  if (
    ts.isBinaryExpression(unwrapped) &&
    (unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return isEqualityDerivedShape(unwrapped.left) || isEqualityDerivedShape(unwrapped.right);
  }
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    unwrapped.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return isEqualityDerivedShape(unwrapped.operand);
  }
  if (
    ts.isCallExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === "Boolean" &&
    unwrapped.arguments.length === 1
  ) {
    return isEqualityDerivedShape(unwrapped.arguments[0]);
  }
  return false;
}

function resolveWrappedBindingNames(sourceFile: ts.SourceFile, seed: Set<string>): Set<string> {
  const tainted = new Set(seed);
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
        if (!isEqualityDerivedShape(init) && subtreeCarriesTaintedName(init, tainted)) {
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

// Round 9 (#108): the dispatcher invented three more shapes after round 8
// shipped. Two (`token.localeCompare(apiKey) === 0`, a template-literal
// compare) were direct-equality RETURNS, still caught by
// `findUnguardedEqualityReturns`, not by this check - the two checks are
// COMPLEMENTARY, and this one is not expected to catch every shape the other
// one does. The third, `isAllowed(String(token), apiKey)`, defeated BOTH:
// `findUnguardedEqualityReturns` never sees inside `isAllowed`, and the old
// identifier-only `classify` here required an argument to BE the bare
// identifier `token`, so `String(token)` - a CallExpression, not an
// Identifier - matched nothing. `findCoOccurrenceViolations` now asks each
// operand/argument "does ANY node in your subtree carry the tainted name",
// via `subtreeCarriesTaintedName`, instead of "ARE you the tainted
// identifier". `String(token)`, `token.trim()`, and `` `${token}` `` all
// still carry the token value no matter what wraps them, so shape 11 dies at
// the `isAllowed(...)` call site the same way `isAllowed(token, apiKey)` did
// in round 8 - the mechanism generalizes instead of adding a `String()` case.
function findCoOccurrenceViolations(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const tokenNames = resolveAliasNames(sourceFile, "token");
  const apiKeyNames = resolveAliasNames(sourceFile, "apiKey");
  // Round 13 (#110): a SEPARATE, wider set used only for the call-argument
  // branch below, not the binary-operand branch. `const t = String(token);
  // return t === apiKey;` (no helper call) must stay findUnguardedEqualityReturns's
  // exclusive domain - see the LOAD-BEARING test pinning that non-redundancy
  // - so the binary-operand branch keeps using the narrower, pre-#110 sets.
  // `const wrapped = String(token); ...; isAllowed(wrapped, apiKey);` (a
  // helper call) is this ticket's actual shape, and only the call-argument
  // branch needs the wider set to see it.
  const tokenNamesForCalls = resolveWrappedBindingNames(sourceFile, tokenNames);
  const apiKeyNamesForCalls = resolveWrappedBindingNames(sourceFile, apiKeyNames);

  const carriesToken = (node: ts.Node): boolean => subtreeCarriesTaintedName(unwrapParens(node as ts.Expression), tokenNames);
  const carriesApiKey = (node: ts.Node): boolean => subtreeCarriesTaintedName(unwrapParens(node as ts.Expression), apiKeyNames);
  const carriesTokenForCall = (node: ts.Node): boolean => subtreeCarriesTaintedName(node, tokenNamesForCalls);
  const carriesApiKeyForCall = (node: ts.Node): boolean => subtreeCarriesTaintedName(node, apiKeyNamesForCalls);

  // TP bounce, round 2 (#110): `timing-safe-token.ts` itself is
  // `const a = Buffer.from(token); const b = Buffer.from(apiKey); ...
  // return timingSafeEqual(a, b);` - a wrap-then-bind into a call, the
  // exact shape Round 13's dataflow extension exists to catch, except this
  // one IS the codebase's one provably-correct constant-time compare.
  // Recognizing the PRIMITIVE the wrapper calls internally, rather than
  // exempting the file by path, means the guard still inspects
  // timing-safe-token.ts's own source (a future edit that stopped calling
  // timingSafeEqual would still be caught) instead of trusting the
  // filename never to change what it does.
  const isApprovedCall = (node: ts.CallExpression): boolean =>
    ts.isIdentifier(node.expression) &&
    (node.expression.text === "timingSafeTokenMatch" || node.expression.text === "timingSafeEqual");

  const offenders: string[] = [];
  const record = (node: ts.Node) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    offenders.push(
      `${fileName}:${line + 1}: token and apiKey co-occur outside timingSafeTokenMatch: ${node.getText(sourceFile).trim()}`,
    );
  };

  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node)) {
      const leftToken = carriesToken(node.left);
      const leftApiKey = carriesApiKey(node.left);
      const rightToken = carriesToken(node.right);
      const rightApiKey = carriesApiKey(node.right);
      if ((leftToken && rightApiKey) || (leftApiKey && rightToken)) record(node);
    } else if (ts.isCallExpression(node) && !isApprovedCall(node)) {
      // Scans the WHOLE call node (callee + arguments), not just
      // `.arguments`, so a method call where the RECEIVER is one value and
      // an ARGUMENT is the other (`token.localeCompare(apiKey)`) is also a
      // co-occurrence - the two values meet at this call just as surely as
      // they would as two arguments. Self-caught while breaking round 9's
      // own fix before reporting it: `.arguments`-only would have missed
      // this receiver+argument shape the same way the old identifier-only
      // `classify` missed `String(token)`.
      const hasToken = carriesTokenForCall(node);
      const hasApiKey = carriesApiKeyForCall(node);
      if (hasToken && hasApiKey) record(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return offenders;
}

// Round 11 (dispatcher, self-corrected by TP/Overwatch): the guard's whole
// output for a source, not "today's two checks" hand-listed at every call
// site. A KNOWN-UNCOVERED tripwire (or a real-route test) that asserts
// against `findUnguardedEqualityReturns` and `findCoOccurrenceViolations`
// by name only proves the two checks that exist right now stay green - a
// future third check closing the gap leaves both of those assertions green
// and nobody is told. Asserting against this instead makes the claim "the
// guard reports nothing" independent of how many checks the guard is made
// of. This is also now the ONLY path the two real-route tests below run
// through, so a future check that isn't wired in here protects no real
// route and is visibly dead code, rather than silently absent the way
// #109's KNOWN_AUTH_ROUTES gap was.
// Round 12, _R1#120: the two checks above both need a precondition that
// the raw pre-#112 gantt-embed source never had. findUnguardedEqualityReturns
// only looks inside a function that already calls timingSafeTokenMatch
// somewhere, and a route that never adopted the helper has no such
// function. findCoOccurrenceViolations only fires when the literal words
// token and apiKey, or a same file alias of them, co-occur, and this
// route's identifiers were auth and embedSecret, neither word present
// anywhere in the file. Both checks are wiring or vocabulary dependent by
// construction, so neither one could ever have caught this route before
// it was fixed, independent of anything _R1#120 changes.
//
// This is the property based net that closes that gap: any equality or
// inequality operator where either side traces, directly or through a
// same file alias, to a secret shaped env var name, regardless of
// whether timingSafeTokenMatch appears anywhere in the file and
// regardless of what the local identifiers are called. It does not need
// a prior call to exist and does not need any particular word to appear,
// because an env var name is a deployment contract, not a naming choice
// a route author makes, and RUNWAY_EMBED_SECRET does not change just
// because the local variable holding it is named embedSecret or auth or
// something else entirely.
function findSecretEnvCompareViolations(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const trace = buildEnvTracedNames(sourceFile);
  const offenders: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && EQUALITY_OPERATOR_KINDS.has(node.operatorToken.kind)) {
      if (!isProvablyNotSecretCompare(node, sourceFile, trace)) {
        const leftNames = resolvedEnvVarNames(node.left, sourceFile, trace);
        const rightNames = resolvedEnvVarNames(node.right, sourceFile, trace);
        const allNames = [...leftNames, ...rightNames];
        // Refs _R1#122: isProvablyNotSecretCompare already judges this
        // compare not provably safe, via the vocabulary OR via
        // reachesAuthSink (env-secret-trace.ts). Requiring the vocabulary
        // hit again here, on top of that, is why a nonce- or salt-shaped
        // name (RUNWAY_EMBED_NONCE) that reaches a real 401 never reached
        // this offender list even after isProvablyNotSecretCompare was
        // taught to catch it. Accepting a sink-shape hit here too lets the
        // answer isProvablyNotSecretCompare already produces actually land.
        //
        // Gate-1 round 2 (QA, real-tree sweep): reachesAuthSink alone,
        // with no regard for whether an env var is involved, turned every
        // untraced authorization compare in the tree (member.role !==
        // "admin", three real routes) into an offender too - this
        // function is specifically the ENV VAR TRACE check, and
        // allNames.length === 0 means there is no env var here at all.
        // isProvablyNotSecretCompare already flags an untraced compare as
        // "not provably safe" for its own separate reason (an untraced
        // identifier could be a secret from anywhere); that is not this
        // function's signal to act on. Requiring at least one traced name
        // before accepting either the vocabulary or the sink-shape hit
        // keeps RUNWAY_EMBED_NONCE (traced, off-vocabulary, sink hit) and
        // drops member.role (traced to nothing).
        if (allNames.length > 0 && (allNames.some(isSecretShapedEnvName) || reachesAuthSink(node, sourceFile))) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          offenders.push(
            `${fileName}:${line + 1}: equality compare involves a secret shaped env var outside timingSafeTokenMatch: ${node.getText(sourceFile).trim()}`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return offenders;
}

function findAllGuardViolations(source: string, fileName: string): string[] {
  return [
    ...findUnguardedEqualityReturns(source, fileName),
    ...findCoOccurrenceViolations(source, fileName),
    ...findSecretEnvCompareViolations(source, fileName),
  ];
}

describe("token-compare guard: findAllGuardViolations aggregates the whole guard (#108 round 11)", () => {
  it("unions a shape findUnguardedEqualityReturns uniquely carries (round 10, shape 12a)", () => {
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const t = String(token);
        return t === apiKey;
      }
    `;
    expect(findAllGuardViolations(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("unions a shape findCoOccurrenceViolations uniquely carries (round 9, shape 8/11, padded helper)", () => {
    const filler = Array.from({ length: 70 }, (_, i) => `        const pad${i} = "x${i}";`).join("\n");
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
${filler}
        return isAllowed(String(token), apiKey);
      }
      function isAllowed(supplied, expected) {
${filler}
        return supplied === expected;
      }
    `;
    expect(findAllGuardViolations(bypass, "fixture.ts")).toHaveLength(1);
  });
});

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
      // Round 11: routed through findAllGuardViolations, the guard's whole
      // output, not this one check by name - see the aggregator's comment.
      // Per-offender messages still name the file, line, and offending
      // text, since each collector already embeds those in what it returns.
      const content = fs.readFileSync(file, "utf-8");
      const offenders = findAllGuardViolations(content, file);
      expect(
        offenders,
        `Guard violation found:\n${offenders.join("\n")}`,
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

  it("flags a plain-equality compare via a method-call RECEIVER, not an argument (round 9, shape 9)", () => {
    // TP invented this one and proved it live: `token.localeCompare(apiKey)`
    // is still a direct-equality RETURN once compared to 0, so this shape
    // was already caught by the same return-expression value-flow this
    // check already had - it's here as a named regression pin, not new
    // mechanism.
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        return token.localeCompare(apiKey) === 0;
      }
    `;
    expect(findUnguardedEqualityReturns(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags a plain-equality compare with both operands wrapped in template literals (round 9, shape 10)", () => {
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        return \`\${token}\` === \`\${apiKey}\`;
      }
    `;
    expect(findUnguardedEqualityReturns(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("LOAD-BEARING: catches a wrapped-then-bound direct-return compare that co-occurrence structurally cannot see (round 10, shape 12a)", () => {
    // This is the shape that disproves "findUnguardedEqualityReturns is
    // redundant now that co-occurrence covers everything it covers" - see
    // the corrected scope-limits bullet at the top of this file. Binding the
    // wrap to `const t` before the compare breaks the inline subtree
    // `findCoOccurrenceViolations` inspects (there is no single node where
    // `token` and `apiKey` co-occur), but the compare is still a direct
    // RETURN, which is exactly this check's own value-flow target and does
    // not depend on the two values ever sharing a syntax node. Confirmed
    // live against the real route file by the dispatcher at round 10: RED,
    // route.ts:36, restored, md5 matched; the co-occurrence check stayed
    // green on the identical mutation.
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const t = String(token);
        return t === apiKey;
      }
    `;
    expect(findUnguardedEqualityReturns(bypass, "fixture.ts")).toHaveLength(1);
    expect(findCoOccurrenceViolations(bypass, "fixture.ts")).toHaveLength(0);
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
    // Round 11: routed through findAllGuardViolations, same as the check
    // above - see the aggregator's comment. Per-offender messages still
    // name the file, line, and offending text.
    const content = fs.readFileSync(file, "utf-8");
    const offenders = findAllGuardViolations(content, file);
    expect(offenders, `Guard violation found:\n${offenders.join("\n")}`).toHaveLength(0);
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

  it("flags a helper call where one argument WRAPS the value instead of being it, unpadded and padded (round 9, shape 8/11)", () => {
    // The dispatcher's round-9 counter-example, proven live at 28/28 green
    // against the real route file before this fix: `String(token)` is a
    // CallExpression, not the bare Identifier `token`, so the pre-round-9
    // `classify` (which required `ts.isIdentifier(unwrapped)`) matched
    // nothing at this argument, and `findUnguardedEqualityReturns` never
    // looks inside `isAllowed` either - both checks stayed green. This is
    // the fixture proof that `subtreeCarriesTaintedName` closes it: the
    // argument's SUBTREE still carries `token` no matter what wraps it.
    const bypassUnpadded = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        return isAllowed(String(token), apiKey);
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
        return isAllowed(String(token), apiKey);
      }
      function isAllowed(supplied, expected) {
${filler}
        return supplied === expected;
      }
    `;
    expect(findCoOccurrenceViolations(bypassPadded, "fixture.ts")).toHaveLength(1);
  });

  it("CLOSED (#110): a value rebound through a wrap and compared inside a helper is now caught by co-occurrence's dataflow extension", () => {
    // Was pinned here as KNOWN UNCOVERED. Round 13 (#110) closed it:
    // `resolveWrappedBindingNames` extends the tainted-name set through a
    // binding, not just an inline wrap, so `wrapped` in `const wrapped =
    // String(token)` is now recognized as carrying the same taint as
    // `token`, and `isAllowed(wrapped, apiKey)` co-occurs just as
    // `isAllowed(String(token), apiKey)` already did before this round.
    // Flipped per the instruction this test itself carried: to
    // `toHaveLength(1)` or greater, not deleted, with the per-check
    // assertion that closed it updated alongside the aggregator.
    // `findUnguardedEqualityReturns` stays at 0 - `isAllowed` is a sibling
    // function, never nested inside `validateAuth` and never calling
    // `timingSafeTokenMatch` itself, so it was never in that check's
    // guarded-function set either before or after this round; the closure
    // is entirely `findCoOccurrenceViolations`'s.
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        const wrapped = String(token);
        return isAllowed(wrapped, apiKey);
      }
      function isAllowed(supplied, expected) {
        return supplied === expected;
      }
    `;
    expect(findAllGuardViolations(bypass, "fixture.ts")).toHaveLength(1);
    expect(findCoOccurrenceViolations(bypass, "fixture.ts")).toHaveLength(1);
    expect(findUnguardedEqualityReturns(bypass, "fixture.ts")).toHaveLength(0);
  });

  it("does not over-taint a boolean RESULT of comparing token and apiKey (#110 acceptance item 3)", () => {
    // Deliberately does NOT route this through findCoOccurrenceViolations or
    // findAllGuardViolations: the line `const ok = token === apiKey;` is, on
    // its own, already an existing violation via the pre-#110 direct-operand
    // branch of findCoOccurrenceViolations (token and apiKey are literally
    // the two operands of that binary expression) - true before this round,
    // true after, unrelated to the dataflow extension. Wrapping this fixture
    // in the aggregator would always show 1+ offenders regardless of whether
    // resolveWrappedBindingNames over-taints `ok`, which would make the
    // proof this item asks for unobservable at that level. Testing
    // `resolveWrappedBindingNames` directly is the precise level: does `ok`
    // itself join the tainted set, yes or no.
    const source = `
      function validateAuth(token, apiKey) {
        const ok = token === apiKey;
        return reportOutcome(ok);
      }
    `;
    const sourceFile = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
    const tokenNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "token"));
    const apiKeyNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "apiKey"));
    expect(tokenNames.has("ok")).toBe(false);
    expect(apiKeyNames.has("ok")).toBe(false);
  });

  it("does not over-taint an equality result nested under a conditional or a logical OR (TP bounce, round 2)", () => {
    // QA's finding: the first exclusion checked only the initializer's own
    // TOP-LEVEL shape, so a compare one level under a ternary or a `||`
    // escaped it. Two separate fixtures, one per shape named in the
    // bounce's acceptance item 3.
    const ternary = `
      function validateAuth(token, apiKey) {
        const ok = someFlag ? (token === apiKey) : false;
        return reportOutcome(ok);
      }
    `;
    const logicalOr = `
      function validateAuth(token, apiKey) {
        const ok = (token === apiKey) || fallbackDenied;
        return reportOutcome(ok);
      }
    `;
    for (const source of [ternary, logicalOr]) {
      const sourceFile = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
      const tokenNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "token"));
      const apiKeyNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "apiKey"));
      expect(tokenNames.has("ok")).toBe(false);
      expect(apiKeyNames.has("ok")).toBe(false);
    }
  });

  it("does not flag the real timing-safe-token.ts wrapper, whose own internal timingSafeEqual call is not the approved name (TP bounce, round 2)", () => {
    // The real, committed, provably-correct implementation: `const a =
    // Buffer.from(token); const b = Buffer.from(apiKey); ...
    // timingSafeEqual(a, b);`. `a` and `b` are wrapped-then-bound, exactly
    // the shape Round 13's dataflow extension exists to catch - the
    // difference is the call they reach is `timingSafeEqual`, the real
    // node:crypto primitive this file exists to wrap, not an unapproved
    // helper. Read from disk, not a hand-written approximation, so a real
    // edit to this file is what this test actually watches.
    const file = path.join(ROOT, "src/lib/runway/timing-safe-token.ts");
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain("timingSafeEqual(a, b)");
    expect(findAllGuardViolations(source, file)).toHaveLength(0);
  });

  it("does not over-taint a negated equality compare, plain or via a method-call receiver (TP bounce, round 3)", () => {
    // QA's round 3 finding: isEqualityDerivedShape enumerated parens,
    // equality, boolean literals, ternary, and &&/|| - no case for a prefix
    // unary NOT, so `const ok = !(token === apiKey);` fell through every
    // check and still tainted `ok`. QA also proved the mechanism, not just
    // the symptom, with a second fixture routing the compare through
    // localeCompare first: same defect, different surface. Both fixtures
    // pinned in one test since they're the same gap. Acceptance items 1
    // and 2 from the round 3 bounce.
    const negatedEquality = `
      function validateAuth(token, apiKey) {
        const ok = !(token === apiKey);
        return reportOutcome(ok);
      }
    `;
    const negatedHelperCompare = `
      function validateAuth(token, apiKey) {
        const mismatch = !(token.localeCompare(apiKey) === 0);
        return reportOutcome(mismatch);
      }
    `;
    for (const [source, name] of [
      [negatedEquality, "ok"],
      [negatedHelperCompare, "mismatch"],
    ] as const) {
      const sourceFile = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
      const tokenNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "token"));
      const apiKeyNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "apiKey"));
      expect(tokenNames.has(name)).toBe(false);
      expect(apiKeyNames.has(name)).toBe(false);
    }
  });

  it("does not over-taint Boolean(...) wrapping an equality compare, the one named call-expression exception (TP bounce, round 3 follow-up)", () => {
    // TP's follow-up after round 3: the closed-grammar bound covers
    // OPERATORS, not every syntax node that happens to produce a boolean.
    // `Boolean(token === apiKey)` is a CALL, and call names are
    // application-chosen - the open corpus this function otherwise
    // refuses to chase. `Boolean` is recognized by name as the one
    // deliberate, narrow exception: a single well-known language built-in,
    // not one instance of an open set of possible wrapper names. See the
    // DESIGN LIMIT comment on isEqualityDerivedShape for why this is
    // closed in a way an arbitrary helper name is not.
    const source = `
      function validateAuth(token, apiKey) {
        const ok = Boolean(token === apiKey);
        return reportOutcome(ok);
      }
    `;
    const sourceFile = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
    const tokenNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "token"));
    const apiKeyNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "apiKey"));
    expect(tokenNames.has("ok")).toBe(false);
    expect(apiKeyNames.has("ok")).toBe(false);
  });

  it("does not over-taint a compare wrapped in value-transparent syntax - comma, as-assertion, non-null postfix, satisfies (TP bounce, round 4)", () => {
    // QA's round 4 finding: unwrapParens only strips parens, so a comma
    // expression, an `as` assertion, a non-null `!` postfix, and a
    // `satisfies` expression all reached isEqualityDerivedShape's branch
    // list with the compare still buried and fell through to `return
    // false`. TP's direction: this is not a fifth enumerated CASE, it's a
    // missing normalization step upstream of every case, since all four
    // are VALUE-TRANSPARENT (their runtime value is exactly their inner
    // expression's, three of them compile-time-only). Generalized
    // `unwrapTransparentValueWrappers` absorbs unwrapParens's own job
    // (paren-stripping falls OUT of it, not beside it) and strips all four,
    // looped until stable. One fixture per shape, all four in one test
    // since they're the same gap.
    const commaExpression = `
      function validateAuth(token, apiKey) {
        const ok = (0, token === apiKey);
        return reportOutcome(ok);
      }
    `;
    const asAssertion = `
      function validateAuth(token, apiKey) {
        const ok = (token === apiKey) as boolean;
        return reportOutcome(ok);
      }
    `;
    const nonNullPostfix = `
      function validateAuth(token, apiKey) {
        const ok = (token === apiKey)!;
        return reportOutcome(ok);
      }
    `;
    const satisfiesExpression = `
      function validateAuth(token, apiKey) {
        const ok = (token === apiKey) satisfies boolean;
        return reportOutcome(ok);
      }
    `;
    for (const source of [commaExpression, asAssertion, nonNullPostfix, satisfiesExpression]) {
      const sourceFile = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
      const tokenNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "token"));
      const apiKeyNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "apiKey"));
      expect(tokenNames.has("ok")).toBe(false);
      expect(apiKeyNames.has("ok")).toBe(false);
    }
  });

  it("survives nested value-transparent wrappers - a comma expression inside an as-assertion (TP bounce, round 4, acceptance item 1)", () => {
    // TP's acceptance bar: "wrapping a compare in two of them at once
    // ... also does not taint, because a loop-until-stable unwrap must
    // survive nesting." Exercises the loop, not just a single strip.
    const source = `
      function validateAuth(token, apiKey) {
        const ok = (0, token === apiKey) as boolean;
        return reportOutcome(ok);
      }
    `;
    const sourceFile = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
    const tokenNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "token"));
    const apiKeyNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "apiKey"));
    expect(tokenNames.has("ok")).toBe(false);
    expect(apiKeyNames.has("ok")).toBe(false);
  });

  it("does not over-taint the older angle-bracket type assertion, the same construct as `as` by a different production (TP bounce, round 5)", () => {
    // QA's finding, TP's ruling: this is not a sixth escaped case, it's an
    // incomplete predicate on a case the design already claims to cover.
    // `<boolean>(token === apiKey)` is the same compile-time-only
    // reinterpretation as `(token === apiKey) as boolean`, just parsed via
    // TypeAssertion instead of AsExpression. Fixed by matching
    // `ts.isAssertionExpression`, the TypeScript API's own shared predicate
    // for both node kinds, rather than adding a second branch.
    const source = `
      function validateAuth(token, apiKey) {
        const ok = <boolean>(token === apiKey);
        return reportOutcome(ok);
      }
    `;
    const sourceFile = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
    const tokenNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "token"));
    const apiKeyNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "apiKey"));
    expect(tokenNames.has("ok")).toBe(false);
    expect(apiKeyNames.has("ok")).toBe(false);
  });

  it("DELIBERATE EXCLUSION: an awaited equality compare STAYS tainted, on purpose, not a missing case (TP round 5 ruling)", () => {
    // `await` on a boolean resolves to that same boolean at runtime, which
    // satisfies this function's transparency criterion on its face - but
    // that transparency only holds because a boolean is never a thenable,
    // a fact this checker has no type information to verify anywhere. TP's
    // ruling: covering it would give this checker an opinion about async
    // dataflow it takes no position on elsewhere in the file, so it is
    // deliberately NOT in unwrapTransparentValueWrappers. This test pins
    // today's behavior - tainted - so a future reader sees a documented
    // decision, not a gap nobody noticed.
    const source = `
      async function validateAuth(token, apiKey) {
        const ok = await (token === apiKey);
        return reportOutcome(ok);
      }
    `;
    const sourceFile = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
    const tokenNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "token"));
    const apiKeyNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "apiKey"));
    expect(tokenNames.has("ok")).toBe(true);
    expect(apiKeyNames.has("ok")).toBe(true);
  });

  it("MECHANISM NOTE: a comma expression with the compare on the LEFT stays tainted, but not because the exclusion logic checked the right side (TP round 5, QA-volunteered)", () => {
    // QA proved this is the right answer for a reason worth naming
    // separately from the outcome. `someOtherThing` is the comma
    // expression's VALUE (unwrapTransparentValueWrappers strips to the
    // rightmost operand), and isEqualityDerivedShape correctly says that
    // bare, unrecognized identifier is not equality-derived - so the
    // exclusion does not fire. But `ok` still ends up tainted regardless,
    // because subtreeCarriesTaintedName scans the WHOLE original
    // initializer text for a tainted name, position-blind, and finds
    // `token` in the discarded left operand independent of anything the
    // unwrap or the exclusion decided. Right answer, different mechanism
    // than a reader might assume.
    const source = `
      function validateAuth(token, apiKey) {
        const ok = (token === apiKey, someOtherThing);
        return reportOutcome(ok);
      }
    `;
    const sourceFile = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
    const tokenNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "token"));
    const apiKeyNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "apiKey"));
    expect(tokenNames.has("ok")).toBe(true);
    expect(apiKeyNames.has("ok")).toBe(true);
  });

  it("DESIGN PIN: isEqualityDerivedShape enumerates a closed operator grammar plus one named built-in, not an open corpus of wrapper calls - an arbitrary helper wrapping the same compare is NOT exempted", () => {
    // This is the test the round 3 bounce asked for: one that pins the
    // DESIGN DECISION, not just another case. isEqualityDerivedShape's
    // exceptions are: parens, the equality operators, boolean literals,
    // ternary, &&/||/??,  unary NOT, and the single named built-in
    // `Boolean(...)`. It does NOT and must NOT treat an arbitrary
    // application-defined helper the same way, even one that is
    // semantically identical to Boolean(...) - `asBoolean(token ===
    // apiKey)` is indistinguishable from `isAllowed(token, apiKey)` to
    // this function by design, because recognizing helper names by
    // convention is exactly the open-corpus problem the closed-grammar
    // bound exists to stay out of. If a future round wants to exempt a
    // specific other helper, that is a new, separately-justified decision,
    // not a natural extension of this one - the whole point of naming
    // Boolean as a language built-in rather than "a common wrapper
    // pattern" is that no other identifier gets to ride in on that
    // reasoning without its own case for why it is closed.
    const source = `
      function validateAuth(token, apiKey) {
        const ok = asBoolean(token === apiKey);
        return reportOutcome(ok);
      }
    `;
    const sourceFile = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
    const tokenNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "token"));
    const apiKeyNames = resolveWrappedBindingNames(sourceFile, resolveAliasNames(sourceFile, "apiKey"));
    // Deliberately still tainted - this is the bound holding, not a bug.
    expect(tokenNames.has("ok")).toBe(true);
    expect(apiKeyNames.has("ok")).toBe(true);
  });

  it("flags a plain-equality compare via a method-call RECEIVER, not an argument (round 9, shape 9)", () => {
    // The receiver `token` in `token.localeCompare(apiKey)` is not one of
    // the CallExpression's `.arguments` - it lives on the callee's
    // PropertyAccessExpression. Scanning the whole call node (callee +
    // arguments), not just `.arguments`, catches this as a co-occurrence in
    // its own right, independent of `findUnguardedEqualityReturns` also
    // catching the outer `=== 0` return.
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        return token.localeCompare(apiKey) === 0;
      }
    `;
    expect(findCoOccurrenceViolations(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("flags a plain-equality compare with both operands wrapped in template literals (round 9, shape 10)", () => {
    const bypass = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      function validateAuth(token, apiKey) {
        if (false) {
          return timingSafeTokenMatch(token, apiKey);
        }
        return \`\${token}\` === \`\${apiKey}\`;
      }
    `;
    expect(findCoOccurrenceViolations(bypass, "fixture.ts")).toHaveLength(1);
  });

  it("does not flag a property named 'token' or 'apiKey' on an unrelated object as if it carried the seed value", () => {
    // No-false-positive check for the PropertyAccessExpression special-case
    // in `subtreeCarriesTaintedName`: a `.name` like the `token` in
    // `logger.token` is a property name, not a reference to the `token`
    // parameter, and must not be treated as tainted just because its text
    // matches.
    const clean = `
      function logRequest(logger, apiKey) {
        logger.token = "unrelated-value";
        return logger.token !== apiKey.length;
      }
    `;
    expect(findCoOccurrenceViolations(clean, "fixture.ts")).toHaveLength(0);
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

describe("token-compare guard: the env var discriminator does not blind the guard, refs _R1#120", () => {
  it("does not flag a NODE_ENV mode check sharing a function with a real timingSafeTokenMatch call", () => {
    const source = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      export async function GET(request) {
        const embedSecret = process.env.RUNWAY_EMBED_SECRET;
        if (!embedSecret) {
          if (process.env.NODE_ENV === "production") {
            return new Response("misconfigured", { status: 500 });
          }
        } else {
          const auth = request.headers.get("x-embed-secret");
          if (!timingSafeTokenMatch(auth, embedSecret)) {
            return new Response("unauthorized", { status: 401 });
          }
        }
        return new Response("ok");
      }
    `;
    expect(findAllGuardViolations(source, "fixture.ts")).toHaveLength(0);
  });

  it("still flags the real pre-#112 gantt-embed source, a committed fixture, not a hand written approximation", () => {
    // Refs _R1#120. This fixture is a verbatim copy of the real, historical
    // file, committed rather than fetched from git at test time. See the
    // fixture's own provenance header for why: the source commit is not an
    // ancestor of upstream/runway after this repo's squash merges and
    // would not resolve in a depth one CI checkout either. A prior version
    // of this test shelled out to git show at run time and would have
    // failed in CI for exactly that reason, caught before it ever pushed.
    const file = path.join(AUTH_ROOT, "runway/gantt-embed/route.ts");
    const fixturePath = path.join(ROOT, "src/lib/runway/__fixtures__/gantt-embed-pre-112.route.txt");
    const fixtureRaw = fs.readFileSync(fixturePath, "utf8");
    const provenanceMarker = "=== END PROVENANCE, ORIGINAL FILE CONTENT STARTS BELOW ===";
    const markerIndex = fixtureRaw.indexOf(provenanceMarker);
    expect(markerIndex).toBeGreaterThan(-1);
    const content = fixtureRaw.slice(markerIndex + provenanceMarker.length).replace(/^\n+/, "");
    expect(content).not.toContain("timingSafeTokenMatch");
    expect(content).toContain("auth !== embedSecret");
    const offenders = findAllGuardViolations(content, file);
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders.some((o) => o.includes("embedSecret"))).toBe(true);
  });

  it("plant and restore: auth === embedSecret in the real route goes red, then green once restored", () => {
    const file = path.join(AUTH_ROOT, "runway/gantt-embed/route.ts");
    const realSource = fs.readFileSync(file, "utf8");
    expect(findAllGuardViolations(realSource, file)).toHaveLength(0);

    const planted = realSource.replace(
      "!timingSafeTokenMatch(auth, embedSecret)",
      "auth === embedSecret",
    );
    expect(planted).not.toBe(realSource);
    const plantedOffenders = findAllGuardViolations(planted, file);
    expect(plantedOffenders.length).toBeGreaterThan(0);
    expect(plantedOffenders.some((o) => o.includes("embedSecret"))).toBe(true);

    expect(findAllGuardViolations(realSource, file)).toHaveLength(0);
  });
});

// ── #122: sink-shape catches a secret outside the five-word vocabulary ──
//
// isSecretShapedEnvName's vocabulary (SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)
// is a fixed word list, the same shape of gap #109 (KNOWN_AUTH_ROUTES) and
// #117 (the token/apiKey vocabulary) already named. RUNWAY_EMBED_NONCE
// reads process.env, is compared with plain === against a header value, and
// gates a real 401 - the exact shape this guard exists to catch - but
// "NONCE" matches none of the five words, so isSecretShapedEnvName says no
// and, before this ticket, findSecretEnvCompareViolations reported nothing
// for it even though isProvablyNotSecretCompare (env-secret-trace.ts,
// _R1#122) had already been taught reachesAuthSink and correctly judged the
// compare not provably safe. The gate inside findSecretEnvCompareViolations
// still required the vocabulary hit on top of that before it would push an
// offender, so the answer isProvablyNotSecretCompare already produced never
// reached the offender list. This is the recorded miss QA reproduced.
describe("token-compare guard: sink-shape catches a nonce-shaped secret outside the five-word vocabulary, refs _R1#122", () => {
  it("plant and restore: RUNWAY_EMBED_NONCE compared with === and gating a real 401 goes red, then clears once guarded", () => {
    const safeSource = `
      import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";
      export async function GET(request: Request) {
        const embedNonce = process.env.RUNWAY_EMBED_NONCE;
        if (!embedNonce) {
          return new Response("misconfigured", { status: 500 });
        }
        const auth = request.headers.get("x-embed-nonce");
        if (!timingSafeTokenMatch(auth, embedNonce)) {
          return new Response("unauthorized", { status: 401 });
        }
        return new Response("ok");
      }
    `;
    expect(findAllGuardViolations(safeSource, "fixture.ts")).toHaveLength(0);

    // RUNWAY_EMBED_NONCE fails the five-word vocabulary outright.
    expect(["RUNWAY_EMBED_NONCE"].some(isSecretShapedEnvName)).toBe(false);

    const planted = safeSource.replace(
      "!timingSafeTokenMatch(auth, embedNonce)",
      "auth !== embedNonce",
    );
    expect(planted).not.toBe(safeSource);
    const plantedOffenders = findAllGuardViolations(planted, "fixture.ts");
    expect(plantedOffenders.length).toBe(1);
    expect(plantedOffenders.some((o) => o.includes("embedNonce"))).toBe(true);

    expect(findAllGuardViolations(safeSource, "fixture.ts")).toHaveLength(0);
  });

  // QA's gate-1 FAIL on this ticket's first attempt: reachesAuthSink is
  // pure text-shape matching, does this branch produce a 401/403, with no
  // regard for whether an env var is involved at all. Wiring it into
  // findSecretEnvCompareViolations as a bare OR alternative to the
  // vocabulary check meant an UNTRACED compare - allNames.length === 0,
  // which isProvablyNotSecretCompare already treats as "not provably
  // safe" for its own separate reason (an untraced identifier could be a
  // secret from anywhere) - also satisfied the offender gate purely on
  // sink shape, with no env var in the picture at all.
  // member.role !== "admin" gating a real 403 is the real-tree shape QA's
  // rebuilt whole-tree sweep found: three routes, same line, none
  // involving process.env or any traced name whatsoever. This function is
  // specifically the ENV VAR TRACE check (see its own name and the
  // module docstring - "an env var name is a deployment contract"); a
  // bare-identifier authorization compare with no env var anywhere in it
  // is not its domain and must not become an offender here.
  it("does not flag an untraced authorization compare (member.role !== \"admin\") that has no env var in it at all", () => {
    const source = `
      export async function POST(request: Request) {
        const member = await getMember(request);
        if (member.role !== "admin") {
          return new Response("forbidden", { status: 403 });
        }
        return new Response("ok");
      }
    `;
    expect(findAllGuardViolations(source, "fixture.ts")).toHaveLength(0);
  });
});

// ── #109: KNOWN_AUTH_ROUTES completeness ────────────────────────────────
//
// Every check above only ever inspects the files listed in KNOWN_AUTH_ROUTES.
// Nothing asserted the list itself was complete, so a new authenticated
// route could ship with no entry, the guard would have nothing to open, and
// the suite would stay green - a pass indistinguishable from a real pass.
//
// The heuristic for "this route needs to be in the list": it imports
// timingSafeTokenMatch, or it reads an env var whose name is secret-shaped
// per isSecretShapedEnvName (the same heuristic env-secret-trace.ts already
// uses elsewhere in this file). Text-based, not the AST walk the call-site
// check above uses - this is a coverage heuristic finding candidate files,
// not the security-critical check on an already-known file.

/** Recursively collects every route.ts under `dir`. */
function walkRouteFiles(dir: string): string[] {
  const found: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkRouteFiles(full));
    } else if (entry.isFile() && entry.name === "route.ts") {
      found.push(full);
    }
  }
  return found;
}

/** True if `filePath`'s content matches the auth heuristic this ticket
 * defines: a live import of timingSafeTokenMatch, or a secret-shaped env
 * var name read anywhere in the file. */
function routeNeedsAuthCoverage(filePath: string): boolean {
  const source = fs.readFileSync(filePath, "utf8");
  if (/\btimingSafeTokenMatch\b/.test(source)) return true;
  return extractEnvVarNames(source).some(isSecretShapedEnvName);
}

/** Every route file under `authRoot` that needs coverage per
 * `routeNeedsAuthCoverage` but is absent from `knownRoutes`. */
function findMissingAuthRouteCoverage(
  authRoot: string,
  knownRoutes: string[],
): string[] {
  const known = new Set(knownRoutes.map((r) => path.resolve(r)));
  return walkRouteFiles(authRoot)
    .filter((f) => routeNeedsAuthCoverage(f))
    .filter((f) => !known.has(path.resolve(f)))
    .sort();
}

// #109's own completeness sweep against the real tree found four routes
// that read SLACK_SIGNING_SECRET (secret-shaped, so the heuristic above
// correctly flags them) but were never in KNOWN_AUTH_ROUTES: each verifies
// via `verifySlackSignature` (src/lib/slack/verify.ts), which itself calls
// Node's native `crypto.timingSafeEqual` on an HMAC digest - a genuinely
// constant-time comparison, just not this guard's `timingSafeTokenMatch`
// wrapper, because these routes authenticate a request signature rather
// than compare a bearer token. Confirmed by reading verify.ts directly,
// not assumed from the import name.
//
// Per this ticket's own instruction, finding these is the deliverable and
// fixing or re-classifying them is not: "I would rather see the list than
// a quiet sweep." Recorded here, explicitly, rather than padding
// KNOWN_AUTH_ROUTES (which would misrepresent them as covered by
// timingSafeTokenMatch specifically) or leaving this check permanently
// red on an unrelated PR. The assertion below is an EXACT match against
// this list, not merely "no new ones" - so a route added to or removed
// from it requires editing this list by hand, in either direction, and
// can never happen silently.
const ACKNOWLEDGED_MISSING_AUTH_COVERAGE = [
  path.join(AUTH_ROOT, "slack/commands/route.ts"),
  path.join(AUTH_ROOT, "slack/events/route.ts"),
  path.join(AUTH_ROOT, "slack/interactivity/route.ts"),
  path.join(AUTH_ROOT, "slack/options/route.ts"),
].sort();

describe("token-compare guard: KNOWN_AUTH_ROUTES completeness (#109)", () => {
  it("every route file matching the auth heuristic is listed in KNOWN_AUTH_ROUTES, or is an acknowledged, explicitly-listed exception", () => {
    const missing = findMissingAuthRouteCoverage(AUTH_ROOT, KNOWN_AUTH_ROUTES).sort();
    expect(
      missing,
      "a route matches the auth heuristic but is neither in KNOWN_AUTH_ROUTES nor ACKNOWLEDGED_MISSING_AUTH_COVERAGE above - list it in one or the other, do not silently drop it",
    ).toEqual(ACKNOWLEDGED_MISSING_AUTH_COVERAGE);
  });

  describe("plant and restore: a route absent from the list is caught, then clears once listed", () => {
    const fixtureDir = path.join(AUTH_ROOT, "__completeness_fixture__");
    const fixtureFile = path.join(fixtureDir, "route.ts");

    afterEach(() => {
      // Always clean up, even if an assertion above throws mid-test, so a
      // failed run never leaves a planted route file behind for the next
      // run (or the completeness check above) to trip on.
      if (fs.existsSync(fixtureFile)) fs.unlinkSync(fixtureFile);
      if (fs.existsSync(fixtureDir)) fs.rmdirSync(fixtureDir);
    });

    it("shows the miss, then the list entry clearing it, then a clean restore", () => {
      fs.mkdirSync(fixtureDir, { recursive: true });
      fs.writeFileSync(
        fixtureFile,
        `import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";\nexport async function GET() { return timingSafeTokenMatch("a", "b"); }\n`,
      );

      // RED: the completeness heuristic itself flags the new file...
      expect(routeNeedsAuthCoverage(fixtureFile)).toBe(true);
      // ...and it is genuinely absent from the real KNOWN_AUTH_ROUTES, the
      // recorded miss this ticket exists to prove.
      const missingBefore = findMissingAuthRouteCoverage(AUTH_ROOT, KNOWN_AUTH_ROUTES);
      expect(missingBefore).toContain(fixtureFile);

      // GREEN: adding it to a routes list clears the finding.
      const withEntry = [...KNOWN_AUTH_ROUTES, fixtureFile];
      const missingAfter = findMissingAuthRouteCoverage(AUTH_ROOT, withEntry);
      expect(missingAfter).not.toContain(fixtureFile);

      // RESTORE: remove the planted file (afterEach also does this; assert
      // here so the restore is verified within the test itself, not only
      // trusted to hook cleanup).
      fs.unlinkSync(fixtureFile);
      fs.rmdirSync(fixtureDir);
      const missingRestored = findMissingAuthRouteCoverage(AUTH_ROOT, KNOWN_AUTH_ROUTES);
      expect(missingRestored).not.toContain(fixtureFile);
    });
  });
});
