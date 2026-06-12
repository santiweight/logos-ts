import tseslint from "typescript-eslint";
import functional from "eslint-plugin-functional";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", ".storybook/**", "eslint.config.js"],
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

      // --- no var, prefer const ---
      "no-var": "error",
      "prefer-const": "error",
    },
  },
);
