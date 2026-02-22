const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");

module.exports = [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "*.local",
      "packages/*/out/**",
      "apps/desktop/src/components/reference/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["apps/desktop/src/**/*.ts", "apps/desktop/src/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@sakti-code/desktop/presentation/providers",
                "@sakti-code/desktop/presentation/providers/*",
              ],
              message: "Use @renderer/presentation/providers/* imports in runtime desktop code.",
            },
            {
              group: [
                "../presentation/providers/*",
                "../../presentation/providers/*",
                "../../../presentation/providers/*",
                "../../../../presentation/providers/*",
              ],
              message: "Use @renderer/presentation/providers/* imports in runtime desktop code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/core/**/*.ts", "packages/core/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@sakti-code/server", "@sakti-code/server/*"],
              message:
                "Core must not import server modules directly. Use core server-bridge contracts instead.",
            },
            {
              group: ["../server/*", "../../server/*", "../../../server/*", "../../../../server/*"],
              message:
                "Core must not reach into server via relative imports. Use core server-bridge contracts instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/core/src/**/__tests__/**/*.ts", "packages/core/src/**/__tests__/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../src/*", "../../src/*", "../../../src/*", "../../../../src/*"],
              message: "Use @/* imports instead of deep relative paths to src.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/core/tests/vitest.setup.ts", "packages/core/tests/helpers/core-db.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
