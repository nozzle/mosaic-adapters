import { defineConfig, devices } from '@playwright/test';
import { baseConfig } from '../../../playwright.config.base';

const PORT = 5120;
const baseURL = `http://localhost:${PORT}`;
const command = `pnpm run build && pnpm run preview --port ${PORT}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  ...baseConfig,
  testDir: './tests',
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
