import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  assetsInclude: ['**/*.md'],
  plugins: [react()],
})
