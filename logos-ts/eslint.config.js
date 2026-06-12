import tseslint from "typescript-eslint";
import functional from "eslint-plugin-functional";

export default tseslint.config(
  {
    // Only src/ is in the tsconfig project; loose scripts can't be type-checked
    ignores: ["**/node_modules/**", "**/dist/**", "studio/**", "*.mjs", "eslint.config.js", "evals/**", ".dev-sessions/**", ".workspaces/**"],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: { functional },
    rules: {
      // --- @typescript-eslint strict rules ---
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",

      // --- eslint-plugin-functional ---
      "functional/no-let": "error",
      "functional/immutable-data": ["error", {
        ignoreClasses: true,
        ignoreImmediateMutation: true,
      }],
      "functional/no-loop-statements": "error",
      "functional/no-throw-statements": "error",
      "functional/prefer-immutable-types": "off",

      // --- ban undefined literal ---
      "no-restricted-syntax": [
        "error",
        {
          selector: "Identifier[name='undefined']",
          message: "Do not use `undefined`. Use Option types or nullability checks instead.",
        },
      ],

      // --- no var, no let (covered above), prefer const ---
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  // --- ts-morph API layer: relax no-unsafe-* rules ---
  // These files interact directly with ts-morph, whose TypeScript Compiler
  // API surfaces `any` extensively. The unsafe rules are enforced everywhere
  // else (the "engine" layer).
  {
    files: [
      "src/architecture.ts",
      "src/archmode.ts",
      "src/backend.ts",
      "src/build-index.ts",
      "src/context.ts",
      "src/dependencies.ts",
      "src/dump.ts",
      "src/project.ts",
      "src/stories.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
