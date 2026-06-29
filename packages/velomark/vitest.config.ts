import { defineConfig } from "vite-plus";
import { createVitestConfig } from "./vitest.shared";

export default defineConfig(createVitestConfig(false));
