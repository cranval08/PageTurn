import { defineConfig, devices } from "@playwright/test";

// E2E builds into dist-e2e with FAKE Google config (env vars override .env.local),
// and every Google endpoint is mocked in tests/e2e/google-mock.ts. Real Drive is tested by hand.
const E2E_ENV = {
  VITE_GOOGLE_CLIENT_ID: "e2e-test-client.apps.googleusercontent.com",
  VITE_GOOGLE_API_KEY: "e2e-test-api-key",
  VITE_GOOGLE_APP_ID: "111111111111",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  // Service workers would bypass page.route mocks; the PWA spec opts back in.
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure", serviceWorkers: "block" },
  webServer: {
    command: "npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: E2E_ENV,
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "pixel-7", use: { ...devices["Pixel 7"] } },
  ],
});
