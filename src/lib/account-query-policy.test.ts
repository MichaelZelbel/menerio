import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("all production QueryClients pass through the account key boundary", () => {
  const violations: string[] = [];
  function visitDir(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { visitDir(path); continue; }
      if (!/\.tsx?$/.test(path) || /\.(test|spec)\./.test(path) || path.endsWith("account-query-client.ts")) continue;
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      const constructors = new Set<string>();
      for (const node of source.statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
        if (!node.moduleSpecifier.text.includes("tanstack")) continue;
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const spec of bindings.elements) {
          if ((spec.propertyName ?? spec.name).text === "QueryClient") constructors.add(spec.name.text);
        }
      }
      function check(node: ts.Node) {
        if (ts.isNewExpression(node) && (constructors.has(node.expression.getText(source)) || node.expression.getText(source).endsWith(".QueryClient"))) violations.push(path);
        ts.forEachChild(node, check);
      }
      check(source);
    }
  }
  visitDir(join(process.cwd(), "src"));
  expect(violations).toEqual([]);
});
