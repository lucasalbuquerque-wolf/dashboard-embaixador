import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Em produção o site fica em https://<user>.github.io/dashboard-embaixador/ (subpasta),
// então os assets precisam do base path. Em dev (npm run dev) fica na raiz.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/dashboard-embaixador/' : '/',
  server: { port: 5173 },
}))
