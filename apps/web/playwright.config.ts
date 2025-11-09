import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/deprecated/**',
  outputDir: 'test-results/playwright-artifacts',
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [['github'], ['html', { outputFolder: 'test-results/playwright-report' }]]
    : [
        ['list'],
        ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }],
      ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
      grepInvert: /@axe/,
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
      },
      grepInvert: /@axe/,
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
      },
      grepInvert: /@axe/,
    },
    {
      name: 'chromium-axe',
      use: {
        ...devices['Desktop Chrome'],
      },
      grep: /@axe/,
      metadata: {
        axeAudits: true,
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: process.env.PLAYWRIGHT_WEB_SERVER_CMD ?? 'npm run dev -- --host',
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
})
