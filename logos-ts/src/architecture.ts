import {
  Node,
  SourceFile,
  SyntaxKind,
  type ParameterDeclaration,
  type PropertyDeclaration,
} from "ts-morph"
import type { Architecture, Decl, Field, FunctionModel, Param, TestModel } from "./model.js"

// A function-like node we can model: declaration, method, arrow, or expression.
type FunctionLike = Parameters<typeof modelFunction>[1]

function safeTypeText(node: { getType: () => { getText: (n?: Node) => string } }, ctx?: Node): string {
  try {
    return node.getType().getText(ctx as Node)
  } catch {
    return "unknown"
  }
}

function modelParam(p: ParameterDeclaration): Param {
  const name = p.getNameNode().getText()
  const type = p.getTypeNode()?.getText() ?? safeTypeText(p, p)
  return { name, type }
}

function modelFunction(
  name: string,
  fn:
    | import("ts-morph").FunctionDeclaration
    | import("ts-morph").MethodDeclaration
    | import("ts-morph").ArrowFunction
    | import("ts-morph").FunctionExpression
): FunctionModel {
  const args = fn.getParameters().map(modelParam)
  let retTy = fn.getReturnTypeNode()?.getText()
  if (!retTy) {
    try {
      retTy = fn.getReturnType().getText(fn)
    } catch {
      retTy = "unknown"
    }
  }
  const body = fn.getBody()?.getText() ?? ""
  return { kind: "function", name, args, retTy, body }
}

function modelField(p: PropertyDeclaration): Field {
  return { name: p.getName(), type: p.getTypeNode()?.getText() ?? safeTypeText(p, p) }
}

// Extract `it(...)` / `test(...)` calls (covers .test.ts and in-source tests).
export function extractTests(sf: SourceFile): TestModel[] {
  const tests: TestModel[] = []
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    let fname = ""
    if (Node.isIdentifier(expr)) fname = expr.getText()
    else if (Node.isPropertyAccessExpression(expr)) fname = expr.getExpression().getText() // it.only -> it
    if (fname !== "it" && fname !== "test") continue

    const callArgs = call.getArguments()
    const nameArg = callArgs[0]
    const name = nameArg && Node.isStringLiteral(nameArg) ? nameArg.getLiteralText() : "<dynamic>"
    const cb = callArgs[callArgs.length - 1]
    tests.push({ name, body: cb ? cb.getText() : "" })
  }
  return tests
}

// API #1: parse one source file into an Architecture.
export function extractArchitecture(sf: SourceFile): Architecture {
  const items: Decl[] = []

  // `function foo() {}`
  for (const fd of sf.getFunctions()) {
    items.push(modelFunction(fd.getName() ?? "<anonymous>", fd))
  }

  // `const Foo = (..) => {}` / `const Foo = function () {}`  (top-level)
  for (const vd of sf.getVariableDeclarations()) {
    const init = vd.getInitializer()
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      items.push(modelFunction(vd.getName(), init))
    }
  }

  // `class Foo {}`
  for (const cd of sf.getClasses()) {
    const fields = cd.getProperties().map(modelField)
    const functions = cd.getMethods().map((m) => modelFunction(m.getName(), m))
    items.push({ kind: "class", name: cd.getName() ?? "<anonymous>", fields, functions })
  }

  return { items, tests: extractTests(sf) }
}
