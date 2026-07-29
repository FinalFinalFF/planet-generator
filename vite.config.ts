import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Served from a GitHub Pages project page, so assets live under the repo name
  // rather than the domain root. A literal (not an env var) so `npm run preview`
  // exercises exactly what ships — dev matching prod is a rule here.
  base: '/planet-generator/',
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
})
