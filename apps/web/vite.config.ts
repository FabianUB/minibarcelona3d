import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"
import { visualizer } from 'rollup-plugin-visualizer'
import fs from 'fs'

const shouldVisualizeBundle =
  typeof process.env.ANALYZE_BUNDLE !== 'undefined' &&
  process.env.ANALYZE_BUNDLE !== '0' &&
  process.env.ANALYZE_BUNDLE !== 'false'

const LOG_POLLS_TO_FILE = process.env.LOG_POLLS_TO_FILE === 'true'
const pollLogPath = path.resolve(__dirname, 'poll-debug.log')

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'poll-debug-file-writer',
      configureServer(server) {
        if (!LOG_POLLS_TO_FILE) {
          return
        }

        server.middlewares.use('/__poll-log', (req, res, next) => {
          if (req.method !== 'POST') {
            return next()
          }

          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body || '{}')
              const record = {
                receivedAt: Date.now(),
                ...parsed,
              }
              fs.appendFileSync(pollLogPath, JSON.stringify(record) + '\n', 'utf8')
              res.statusCode = 200
              res.end('ok')
            } catch (err) {
              console.error('Failed to write poll log', err)
              res.statusCode = 400
              res.end('error')
            }
          })
        })
      },
    },
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
})
