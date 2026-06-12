import tseslint from "typescript-eslint";

export default tseslint.config(
  {
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
    rules: {
      // --- bug-catchers (error) ---
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",

      // --- worth seeing but not blocking (warn) ---
      "@typescript-eslint/strict-boolean-expressions": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-explicit-any": "warn",

      // --- too noisy, turn off ---
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",

      // --- ban undefined literal ---
      "no-restricted-syntax": [
        "error",
        {
          selector: "Identifier[name='undefined']",
          message: "Do not use `undefined`. Use Option types or nullability checks instead.",
        },
      ],

      "no-var": "error",
      "prefer-const": "error",
    },
  },
  // --- ts-morph API layer: relax no-unsafe-* rules ---
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
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
