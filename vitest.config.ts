import { defineConfig } from 'vitest/config'

/**
 * Separate from vite.config.ts on purpose: the app config carries the Pages
 * `base` and the React plugin, neither of which these tests want.
 *
 * Node environment by default — the remix and zip contracts are pure. The parse
 * test needs DOMParser/XMLSerializer and opts into jsdom with a
 * `@vitest-environment` docblock, so only that one file pays for it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
