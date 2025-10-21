import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

const shouldVisualizeBundle =
  typeof process.env.ANALYZE_BUNDLE !== 'undefined' &&
  process.env.ANALYZE_BUNDLE !== '0' &&
  process.env.ANALYZE_BUNDLE !== 'false'

export default defineConfig({
  plugins: [
    react(),
    ...(shouldVisualizeBundle
      ? [
          visualizer({
            filename: 'dist/bundle-analysis.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://api:8080', 
        changeOrigin: true,
      },
    },
  },
})
