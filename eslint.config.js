import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist"]
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json"
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error"
    }
  }
);
