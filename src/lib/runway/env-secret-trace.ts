/**
 * Shared env var tracer, refs _R1#117 and _R1#120. Ported from
 * scripts/secret-compare-census.ts on chore/117-secret-compare-census
 * rather than reimplemented, so the census and the guard agree on what
 * counts as a traced env var by construction, not by coincidence.
 *
 * The property this exists for: an env var NAME is a deployment contract,
 * not a local naming choice. `auth` and `embedSecret` were free choices by
 * whoever wrote a route. RUNWAY_EMBED_SECRET was not, and it changes
 * rarely and visibly. Tracing an expression to the env var it reads from,
 * then judging that name, catches a secret regardless of what a route
 * author called the local variable holding it, and does not flag a
 * NODE_ENV or feature flag check just because it also happens to compare
 * an env value with an equality operator.
 */
import * as ts from "typescript";

/** True if this initializer, at its own top level, is a plain alias
 * rather than a computation: a bare identifier, a process.env access, a
 * member access rooted at a traced identifier, or one of those wrapped
 * in a nullish or logical-or default, an optional chain, or a type
 * assertion. Deliberately strict, so a value merely computed from an env
 * read does not propagate the trace the way a real rename chain does. */
export function aliasTarget(expr: ts.Expression): { text: string } | null {
  let e = expr;
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e)
  ) {
    e = ts.isParenthesizedExpression(e)
      ? e.expression
      : (e as ts.AsExpression | ts.NonNullExpression | ts.SatisfiesExpression).expression;
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return aliasTarget(e.left);
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return aliasTarget(e.left);
  }
  if (ts.isIdentifier(e)) return { text: e.text };
  if (ts.isPropertyAccessExpression(e)) {
    const base = aliasTarget(e.expression);
    return base ? { text: `${base.text}.${e.name.text}` } : null;
  }
  return null;
}

export function textHasProcessEnv(text: string): boolean {
  return /\bprocess\s*\.\s*env\b/.test(text);
}

export function extractEnvVarNames(text: string): string[] {
  const names: string[] = [];
  const re1 = /process\s*\.\s*env\s*\.\s*([A-Za-z0-9_]+)/g;
  const re2 = /process\s*\.\s*env\s*\[\s*["']([A-Za-z0-9_]+)["']\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text))) names.push(m[1]);
  while ((m = re2.exec(text))) names.push(m[1]);
  return names;
}

/** True if a name follows the deployment contract naming shape of a
 * secret, a credential, or a token, as opposed to a mode flag such as
 * NODE_ENV or VERCEL_ENV, or a feature flag such as DRY_RUN. */
export function isSecretShapedEnvName(name: string): boolean {
  return /SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL/i.test(name);
}

export type EnvTrace = { names: Set<string>; envVarByName: Map<string, string[]> };

/** Builds, for one file, the set of identifier names whose declared
 * value traces to process.env, directly or through a chain of same file
 * aliases, plus a map back to the actual env var name or names each
 * traced identifier resolves to. */
export function buildEnvTracedNames(sourceFile: ts.SourceFile): EnvTrace {
  const declarations: Array<{ name: string; initializer: ts.Expression }> = [];

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        declarations.push({ name: node.name.text, initializer: node.initializer });
      } else if (ts.isObjectBindingPattern(node.name) && textHasProcessEnv(node.initializer.getText(sourceFile))) {
        for (const el of node.name.elements) {
          if (ts.isIdentifier(el.name)) {
            declarations.push({ name: el.name.text, initializer: node.initializer });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const traced = new Set<string>();
  const envVarByName = new Map<string, string[]>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const decl of declarations) {
      if (traced.has(decl.name)) continue;
      const initText = decl.initializer.getText(sourceFile);
      const target = aliasTarget(decl.initializer);
      const direct = textHasProcessEnv(initText) && target !== null;
      const aliasRoot = target ? target.text.split(".")[0] : null;
      const viaAlias = aliasRoot ? traced.has(aliasRoot) : false;
      if (direct || viaAlias) {
        traced.add(decl.name);
        const ownNames = extractEnvVarNames(initText);
        const inherited = aliasRoot ? (envVarByName.get(aliasRoot) ?? []) : [];
        envVarByName.set(decl.name, Array.from(new Set([...ownNames, ...inherited])));
        changed = true;
      }
    }
  }
  return { names: traced, envVarByName };
}

/** Every env var name a given expression resolves to, directly or
 * through the trace built by buildEnvTracedNames. Empty if the
 * expression does not trace to any known env var. */
export function resolvedEnvVarNames(expr: ts.Expression, sourceFile: ts.SourceFile, trace: EnvTrace): string[] {
  const text = expr.getText(sourceFile);
  const own = extractEnvVarNames(text);
  if (ts.isIdentifier(expr)) {
    return Array.from(new Set([...own, ...(trace.envVarByName.get(expr.text) ?? [])]));
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return Array.from(new Set([...own, ...(trace.envVarByName.get(expr.expression.text) ?? [])]));
  }
  return own;
}

/**
 * True if an equality binary expression is provably not a secret
 * compare: every env var name either side of it resolves to exists and
 * is not secret shaped. Returns false, meaning treat it as a possible
 * secret compare, whenever neither side traces to any known env var at
 * all, since an untraced identifier such as a bare `token` parameter
 * could be a secret from anywhere and this function has no way to rule
 * that out. Only a trace that positively resolves to a non secret env
 * var name is grounds to exempt a compare.
 */
export function isProvablyNotSecretCompare(
  binary: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  trace: EnvTrace,
): boolean {
  const leftNames = resolvedEnvVarNames(binary.left, sourceFile, trace);
  const rightNames = resolvedEnvVarNames(binary.right, sourceFile, trace);
  const allNames = [...leftNames, ...rightNames];
  if (allNames.length === 0) return false;
  return !allNames.some(isSecretShapedEnvName);
}
