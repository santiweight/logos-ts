// Oracle for Logos build-index React wrapper component detection. Runs in the
// Logos repo root copied by the eval harness.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const { buildStudioIndex } = await import(pathToFileURL(join(process.cwd(), "src", "build-index.ts")).href);

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-react-wrapper-eval-"));
  mkdirSync(join(root, "components"), { recursive: true });
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(root, "components", "Button.tsx"), `
    import React, { forwardRef, memo } from "react";

    interface ButtonProps {
      label: string;
      disabled?: boolean;
    }

    export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
      function Button({ label, disabled }, ref) {
        return <button ref={ref} disabled={disabled}>{label}</button>;
      }
    );

    type BadgeProps = {
      tone: "ok" | "warn";
      children?: string;
    };

    export const Badge = memo(function Badge({ tone, children }: BadgeProps) {
      return <span data-tone={tone}>{children}</span>;
    });

    type IconProps = {
      title: string;
    };

    export const Icon = memo(forwardRef<SVGSVGElement, IconProps>(
      function Icon({ title }, ref) {
        return <svg ref={ref}><title>{title}</title></svg>;
      }
    ));

    export const ElementButton = forwardRef<HTMLButtonElement, ButtonProps>(
      function ElementButton({ label, disabled }, ref) {
        return React.createElement("button", { ref, disabled }, label);
      }
    );

    export const button = forwardRef<HTMLButtonElement, ButtonProps>(
      function button({ label }, ref) {
        return <button ref={ref}>{label}</button>;
      }
    );
  `);
  return root;
}

test("buildStudioIndex detects forwardRef components and generic props", () => {
  const root = fixture();
  try {
    const file = buildStudioIndex(root).files.find((entry) => entry.file === "components/Button.tsx");
    const button = file?.components?.find((component) => component.name === "Button");

    assert.equal(button?.signature, "Button(props: ButtonProps)");
    assert.equal(button?.propsName, "ButtonProps");
    assert.deepEqual(button?.propsFields, [
      { name: "label", type: "string" },
      { name: "disabled?", type: "boolean" },
    ]);
    assert.match(button?.componentCode ?? "", /forwardRef/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildStudioIndex detects memo-wrapped named function components", () => {
  const root = fixture();
  try {
    const file = buildStudioIndex(root).files.find((entry) => entry.file === "components/Button.tsx");
    const badge = file?.components?.find((component) => component.name === "Badge");

    assert.equal(badge?.signature, "Badge(props: BadgeProps)");
    assert.equal(badge?.propsName, "BadgeProps");
    assert.deepEqual(badge?.propsFields, [
      { name: "tone", type: "\"ok\" | \"warn\"" },
      { name: "children?", type: "string" },
    ]);
    assert.match(badge?.componentCode ?? "", /memo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildStudioIndex detects nested memo forwardRef wrappers and ignores lowercase variables", () => {
  const root = fixture();
  try {
    const file = buildStudioIndex(root).files.find((entry) => entry.file === "components/Button.tsx");
    const names = file?.components?.map((component) => component.name);
    const icon = file?.components?.find((component) => component.name === "Icon");

    assert.deepEqual(names, ["Button", "Badge", "Icon", "ElementButton"]);
    assert.equal(icon?.signature, "Icon(props: IconProps)");
    assert.equal(icon?.propsName, "IconProps");
    assert.deepEqual(icon?.propsFields, [{ name: "title", type: "string" }]);
    assert.match(icon?.componentCode ?? "", /memo\(forwardRef<SVGSVGElement, IconProps>/);
    assert.equal(file?.components?.some((component) => component.name === "button"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildStudioIndex detects forwardRef wrappers without JSX descendants", () => {
  const root = fixture();
  try {
    const file = buildStudioIndex(root).files.find((entry) => entry.file === "components/Button.tsx");
    const elementButton = file?.components?.find((component) => component.name === "ElementButton");

    assert.equal(elementButton?.signature, "ElementButton(props: ButtonProps)");
    assert.equal(elementButton?.propsName, "ButtonProps");
    assert.match(elementButton?.componentCode ?? "", /React\.createElement/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
