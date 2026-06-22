// Oracle for keeping Architecture extraction scoped to file-level declarations.
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Project, ts } from "ts-morph";

const { extractArchitecture } = await import(pathToFileURL(join(process.cwd(), "src", "architecture.ts")).href);

function source(text: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  });
  return project.createSourceFile("sample.ts", text);
}

test("extractArchitecture ignores local function-valued variables", () => {
  const arch = extractArchitecture(source(`
    export const topLevel = () => "top";
    export let mutableTopLevel = () => "mutable";
    export var legacyTopLevel = function () { return "legacy"; };

    export function outer() {
      const localArrow = () => "local";
      const localFunction = function () { return "nested"; };
      return localArrow() + localFunction();
    }
  `));

  assert.deepEqual(arch.items.map((item) => item.name), ["outer", "topLevel"]);
  assert.equal(arch.items.some((item) => item.name === "localArrow"), false);
  assert.equal(arch.items.some((item) => item.name === "localFunction"), false);
  assert.equal(arch.items.some((item) => item.name === "mutableTopLevel"), false);
  assert.equal(arch.items.some((item) => item.name === "legacyTopLevel"), false);
});

test("extractArchitecture still captures top-level function expressions", () => {
  const arch = extractArchitecture(source(`
    export const arrow = (value: string): string => value.trim();
    export const fn = function (value: number): number { return value + 1; };
  `));

  assert.deepEqual(arch.items.map((item) => item.name), ["arrow", "fn"]);
  assert.equal(arch.items[0]?.kind, "function");
  assert.equal(arch.items[1]?.kind, "function");
});
