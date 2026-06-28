import solidPlugin from "vite-plugin-solid";
import type { UserConfig } from "vitest/config";

const WEB_TRANSFORM_GLOBS = ["**/*.{js,jsx,ts,tsx}"];
const CLIENT_TEST_GLOBS = [
  "src/**/__tests__/**/*.test.{ts,tsx}",
  "dev/**/__tests__/**/*.test.{ts,tsx}",
  "test/*.test.{ts,tsx}",
];
const SSR_TEST_GLOBS = ["test/server.test.tsx"];
const COVERAGE_CONFIG = {
  all: true,
  exclude: ["src/**/__tests__/**", "src/**/*.test.{ts,tsx}", "src/**/*.d.ts"],
  include: ["src/**/*.{ts,tsx}"],
  provider: "v8" as const,
  thresholds: {
    branches: 75,
    functions: 80,
    lines: 80,
    statements: 80,
  },
};

export function createVitestConfig(testSSR: boolean): UserConfig {
  return {
    mode: testSSR ? "ssr" : "test",
    plugins: [
      solidPlugin({
        hot: false,
        solid: { generate: testSSR ? "ssr" : "dom" },
      }),
    ],
    test: {
      name: testSSR ? "ssr" : "client",
      watch: false,
      isolate: !testSSR,
      env: {
        NODE_ENV: testSSR ? "production" : "development",
        DEV: testSSR ? "" : "1",
        SSR: testSSR ? "1" : "",
        PROD: testSSR ? "1" : "",
      },
      environment: testSSR ? "node" : "jsdom",
      testTransformMode: { web: WEB_TRANSFORM_GLOBS },
      coverage: COVERAGE_CONFIG,
      ...(testSSR
        ? {
            include: SSR_TEST_GLOBS,
          }
        : {
            include: CLIENT_TEST_GLOBS,
            exclude: SSR_TEST_GLOBS,
          }),
    },
    resolve: {
      conditions: testSSR ? ["node"] : ["browser", "development"],
    },
  };
}
