import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Chrome 109 is the last Chrome release that runs on Windows 7.
const LEGACY_TARGET = 'chrome109'

export default defineConfig(({ mode }) => {
  const portable = mode === 'portable'

  return {
    base: portable ? './' : '/',
    plugins: [react(), tailwindcss(), ...(portable ? [viteSingleFile()] : [])],
    css: portable
      ? {
          transformer: 'lightningcss',
          lightningcss: {
            // Chrome 109 encoded as major << 16 — lowers oklch()/color-mix() to rgb.
            targets: { chrome: 109 << 16 },
          },
        }
      : undefined,
    build: portable
      ? {
          target: LEGACY_TARGET,
          cssTarget: LEGACY_TARGET,
          cssMinify: 'lightningcss',
          outDir: 'dist-portable',
        }
      : undefined,
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  }
})
