import { defineConfig } from '@playwright/test';

/**
 * Shared Playwright config for all example projects.
 * Individual examples extend this with their own webServer and project settings.
 */
export const baseConfig = defineConfig({
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'line',
});
