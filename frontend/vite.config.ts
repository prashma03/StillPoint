/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  cacheDir: process.env.STILLPOINT_E2E ? 'node_modules/.vite-privacy-e2e' : 'node_modules/.vite',
  plugins: [react()],
  // Load the SDK directly in module workers. Optimized dependency URLs can
  // become stale when Vite rebuilds its cache while an app tab remains open.
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  worker: { format: 'es' },
  server: {
    port: 5173,
    fs: { allow: [frontendRoot, repoRoot] },
  },
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    maxWorkers: 2,
  },
})
