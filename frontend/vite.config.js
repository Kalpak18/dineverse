import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:5000';

  return {
    plugins: [
      react(),
    ],
    build: {
      rollupOptions: {
        output: {
          // Split large vendor libraries into separate cacheable chunks
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) return 'vendor-react';
              if (id.includes('socket.io')) return 'vendor-socket';
              if (id.includes('leaflet'))   return 'vendor-leaflet';
              return 'vendor-misc';
            }
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('error', () => {}); // suppress ECONNRESET/ECONNREFUSED during backend restarts
          },
        },
        '/socket.io': {
          target: backendUrl,
          ws: true,
          configure: (proxy) => {
            proxy.on('error', () => {}); // suppress WebSocket proxy errors during backend restarts
          },
        },
      },
    },
  };
});
