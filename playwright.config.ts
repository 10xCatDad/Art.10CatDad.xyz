import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests", testMatch: "*.spec.ts", fullyParallel: false, workers: 1, timeout: 45000, outputDir: "outputs/test-results", reporter: "list", use: { baseURL: "http://127.0.0.1:5187", headless: true, viewport: { width: 1440, height: 1000 } } });
