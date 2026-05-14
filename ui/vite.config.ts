import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../frontend',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/papers': 'http://localhost:8000',
      '/strategies': 'http://localhost:8000',
      '/backtest': 'http://localhost:8000',
    },
  },
})
