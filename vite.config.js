import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  build: { assetsDir: 'build-assets', rollupOptions: { input: {
    party: fileURLToPath(new URL('./index.html', import.meta.url)),
    nexus: fileURLToPath(new URL('./nexus.html', import.meta.url)),
    messengerEmbed: fileURLToPath(new URL('./messenger-embed.html', import.meta.url)),
  } } },
})
