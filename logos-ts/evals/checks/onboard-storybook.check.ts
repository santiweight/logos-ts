import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const pkg = JSON.parse(read("package.json")) as {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
};

function walk(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const rel = join(dir, entry);
    const full = join(root, rel);
    if (entry === "node_modules" || entry === ".next" || entry === "storybook-static") continue;
    if (statSync(full).isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

assert.match(pkg.scripts?.storybook ?? "", /storybook\s+dev/, "package.json needs a storybook dev script");
assert.match(pkg.scripts?.["build-storybook"] ?? "", /storybook\s+build/, "package.json needs a build-storybook script");

const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
assert.ok(allDeps.storybook, "real storybook dependency must be installed");
assert.ok(
  allDeps["@storybook/nextjs-vite"] || allDeps["@storybook/nextjs"] || allDeps["@storybook/react-vite"],
  "a real Storybook React/Next framework package must be installed"
);
assert.ok(allDeps["@storybook/addon-docs"] || allDeps["@storybook/addon-essentials"], "Storybook docs/essentials addon should be installed");

assert.ok(existsSync(join(root, ".storybook/main.ts")) || existsSync(join(root, ".storybook/main.js")), ".storybook/main is required");
assert.ok(existsSync(join(root, ".storybook/preview.ts")) || existsSync(join(root, ".storybook/preview.js")), ".storybook/preview is required");

const mainText = existsSync(join(root, ".storybook/main.ts")) ? read(".storybook/main.ts") : read(".storybook/main.js");
assert.match(mainText, /stories\s*:/, "main config must define story globs");
assert.match(mainText, /framework\s*:/, "main config must define a framework");

const previewText = existsSync(join(root, ".storybook/preview.ts")) ? read(".storybook/preview.ts") : read(".storybook/preview.js");
assert.match(previewText, /globals\.css|global\.css|\.css["']/, "preview config should import app/global CSS");

const storyFiles = [...walk("app"), ...walk("components")].filter((file) => /\.stories\.(tsx|jsx|ts|js)$/.test(file));
assert.ok(storyFiles.length > 0, "at least one starter story is required");

const storyText = storyFiles.map((file) => read(file)).join("\n");
assert.match(storyText, /Meta/, "starter story should use typed Meta");
assert.match(storyText, /StoryObj/, "starter story should use typed StoryObj");
assert.match(storyText, /component\s*:/, "starter story should bind a component");
assert.ok([...storyText.matchAll(/export const \w+\s*:/g)].length >= 2, "starter story should include multiple states");
assert.doesNotMatch(storyText, /fetch\(|prisma|process\.env|Math\.random|Date\.now/, "stories should use deterministic local fixtures");

const declarationFiles = walk(".").filter((file) => /\.d\.ts$/.test(file));
const fakeStorybookTypes = declarationFiles.filter((file) =>
  read(file).includes('declare module "@storybook/react"')
);
assert.deepEqual(fakeStorybookTypes, [], "do not fake Storybook types with local declaration stubs");
