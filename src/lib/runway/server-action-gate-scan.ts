import * as ts from "typescript";

/**
 * Finds every server action in one source file and reports each one whose
 * first statement is not `await requireRunwayGate()`. Parses the file with
 * the TypeScript compiler, so a commented-out call does not count.
 */
export type GateScanResult = {
  /** Server actions whose first statement is the gate call. */
  gated: string[];
  /** Server actions with no gate call first, or an export shape the scan cannot check. */
  ungated: string[];
};

function isUseServerDirective(stmt: ts.Statement): boolean {
  return (
    ts.isExpressionStatement(stmt) &&
    ts.isStringLiteral(stmt.expression) &&
    stmt.expression.text === "use server"
  );
}

function hasUseServerDirective(statements: readonly ts.Statement[]): boolean {
  for (const stmt of statements) {
    if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteral(stmt.expression)) {
      return false;
    }
    if (isUseServerDirective(stmt)) return true;
  }
  return false;
}

function isGateCall(stmt: ts.Statement | undefined): boolean {
  if (!stmt || !ts.isExpressionStatement(stmt)) return false;
  const expr = stmt.expression;
  if (!ts.isAwaitExpression(expr)) return false;
  const call = expr.expression;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "requireRunwayGate" &&
    call.arguments.length === 0
  );
}

function firstRealStatement(block: ts.Block): ts.Statement | undefined {
  return block.statements.find((s) => !isUseServerDirective(s));
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

function bodyIsGated(fn: FunctionLike): boolean {
  return !!fn.body && ts.isBlock(fn.body) && isGateCall(firstRealStatement(fn.body));
}

export function scanServerActionGates(
  fileName: string,
  source: string,
  allowUngated: ReadonlySet<string> = new Set(),
): GateScanResult {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const result: GateScanResult = { gated: [], ungated: [] };
  const record = (name: string, gated: boolean) => {
    if (allowUngated.has(name)) return;
    (gated ? result.gated : result.ungated).push(name);
  };

  if (hasUseServerDirective(sf.statements)) {
    for (const stmt of sf.statements) {
      if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;
      if (ts.isExportDeclaration(stmt)) {
        if (!stmt.isTypeOnly) record(`export-list@${stmt.getStart(sf)}`, false);
        continue;
      }
      if (ts.isExportAssignment(stmt)) {
        record("default", false);
        continue;
      }
      if (!isExported(stmt)) continue;
      if (ts.isFunctionDeclaration(stmt)) {
        record(stmt.name?.text ?? "default", bodyIsGated(stmt));
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          const init = decl.initializer;
          const fn =
            init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : null;
          record(decl.name.getText(sf), fn ? bodyIsGated(fn) : false);
        }
      } else {
        record(`export@${stmt.getStart(sf)}`, false);
      }
    }
  }

  // A function with its own "use server" directive is also a server action.
  const visit = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      hasUseServerDirective(node.body.statements)
    ) {
      const name =
        ts.isFunctionDeclaration(node) && node.name
          ? node.name.text
          : `inline@${node.getStart(sf)}`;
      record(name, bodyIsGated(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return result;
}
