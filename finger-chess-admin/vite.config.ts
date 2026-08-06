import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.VITE_FINGER_CHESS_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor code changes far less often than app code — splitting it
        // into its own chunk means a deploy that only touches app code
        // doesn't invalidate the browser cache for React/Recharts/etc,
        // which is by far the largest and most stable part of the bundle.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
        },
      },
    },
    // Recharts alone comfortably exceeds Vite's default 500KB warning
    // threshold; raised deliberately rather than silencing the warning
    // without looking at what's actually in the chunk.
    chunkSizeWarningLimit: 600,
  },
});
