import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: ["dist", "storybook-static", "node_modules", "coverage", "test-results"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
)
