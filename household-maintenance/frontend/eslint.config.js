import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "storybook-static/**",
    ],
  },
  ...tseslint.configs.recommended,
)
