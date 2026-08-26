import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Served from the domain root of orbs.fnfn.us (custom domain on GitHub
  // Pages; see public/CNAME). A literal (not an env var) so `npm run preview`
  // exercises exactly what ships — dev matching prod is a rule here.
  //
  // Before the custom domain this was '/planet-generator/' — the GitHub repo
  // slug, under which Pages serves a project page. If the custom domain is
  // ever removed, that base must come back in the same change, or every asset
  // on the live site 404s.
  base: '/',
  plugins: [react()],
  // @ffmpeg/ffmpeg spawns its class worker via a relative import.meta.url;
  // dep pre-bundling rewrites the package into .vite/deps where that URL
  // 404s and load() hangs forever. Excluding it keeps the package on disk.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  server: { port: 5173 },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
})
