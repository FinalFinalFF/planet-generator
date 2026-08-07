import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Served from a GitHub Pages project page, so assets live under the repo name
  // rather than the domain root. A literal (not an env var) so `npm run preview`
  // exercises exactly what ships — dev matching prod is a rule here.
  //
  // This is the GitHub repo slug, not the product name: the app was renamed
  // planet→orb but the repo is still FinalFinalFF/planet-generator. Changing
  // this string without renaming the repo 404s every asset on the live site.
  base: '/planet-generator/',
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
})
