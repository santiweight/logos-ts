import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "eslint.config.js", "vite.config.ts", "vitest.config.ts", ".storybook/**", "bin/**", "*.mjs"],
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
);
