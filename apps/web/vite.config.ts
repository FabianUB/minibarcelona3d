import path from "path"
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"
import { visualizer } from 'rollup-plugin-visualizer'
import { configDefaults } from 'vitest/config'
import type { PluginOption } from 'vite'

const shouldVisualizeBundle =
  typeof process.env.ANALYZE_BUNDLE !== 'undefined' &&
  process.env.ANALYZE_BUNDLE !== '0' &&
  process.env.ANALYZE_BUNDLE !== 'false'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
	    ...(shouldVisualizeBundle
	      ? [
	          visualizer({
	            filename: 'dist/bundle-analysis.html',
	            template: 'treemap',
	            gzipSize: true,
	            brotliSize: true,
	          }) as PluginOption,
	        ]
	      : []),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
