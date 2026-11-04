import { defineConfig } from '@playwright/test'
const port = process.env.STILLPOINT_E2E_PORT || '5186'
const baseURL = `http://127.0.0.1:${port}`
export default defineConfig({
  testDir: './e2e', timeout: 90000, workers: 1,
  use: { baseURL, headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined) } },
  webServer: { command: `npm run ${process.env.STILLPOINT_PREVIEW ? 'preview' : 'dev'} -- --host 127.0.0.1 --port ${port} --strictPort`, url: baseURL, timeout: 60000, reuseExistingServer: false, env: { STILLPOINT_E2E: '1' } },
})
