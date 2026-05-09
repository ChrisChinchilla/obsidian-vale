import obsidian from "eslint-plugin-obsidianmd";

export default [
  ...obsidian.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    ignores: ["main.js", "node_modules/**", "dist/**"],
  },
];
