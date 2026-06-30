import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: [
      "dist/", "node_modules/", "coverage/",
      "**/dist/", "**/node_modules/", "**/coverage/",
      "*.js", "*.mjs", "*.cjs",
      "apps/electron-demo/dist-electron/",
      "**/*.d.ts",
    ],
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly", document: "readonly", console: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly",
        setInterval: "readonly", clearInterval: "readonly",
        HTMLElement: "readonly", Event: "readonly",
        requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
        localStorage: "readonly", sessionStorage: "readonly",
        globalThis: "readonly", Promise: "readonly",
        Map: "readonly", Set: "readonly", WeakMap: "readonly", WeakSet: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  }
);
