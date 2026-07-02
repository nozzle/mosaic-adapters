import { defineConfig, devices } from '@playwright/test';
import { baseConfig } from '../../../playwright.config.base';

const PORT = 5120;
const baseURL = `http://localhost:${PORT}`;
const command = `pnpm run build && pnpm run preview --port ${PORT}`;

export default defineConfig({
  ...baseConfig,
  testDir: './tests',
  // First paint waits on DuckDB-WASM + a remote parquet download.
  timeout: 90_000,
  use: {
    baseURL,
  },

  webServer: {
    command,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
