import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const frontendPort = Number(env.VITE_PORT || env.FRONTEND_PORT) || 5173
  const apiPort = Number(env.VITE_API_PORT || env.API_PORT) || 3001

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: frontendPort,
      strictPort: false,
      allowedHosts: ['.monkeycode-ai.live'],
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: false
    }
  }
})
