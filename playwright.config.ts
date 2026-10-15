import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5187",
    viewport: { width: 1440, height: 1050 },
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:5187",
    reuseExistingServer: false,
    env: {
      VAULTRAM_MODE: "SIMULATED",
      VAULTRAM_PORT: "8797",
      VAULTRAM_UI_PORT: "5187",
      VAULTRAM_DATA_DIR: `.data/e2e-${process.pid}`,
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
    },
    timeout: 30000,
  },
  reporter: "list",
});
