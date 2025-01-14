/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    globalSetup: './vitest.global-setup.ts',
    include: ['src/**/*.test.ts'],
    exclude: ['test/*', 'node_modules'],
    coverage: {
      reporter: ['html', 'json']
    }
  },
})
