import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:5000';

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        injectManifest: {
          injectionPoint: 'self.__WB_MANIFEST',
        },
        manifest: false, // we already have public/site.webmanifest
      }),
    ],
    build: {
      // Raise chunk-size warning threshold; our lazy-split chunks are intentionally larger
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        external: ['@capacitor-community/barcode-scanner'],
        output: {
          // Vendor libraries are versioned by npm, so they can be cached forever.
          // Splitting them into a separate chunk means a deploy that touches only
          // app code never invalidates the user's cached React/socket.io download.
          manualChunks(id) {
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run')) {
              return 'vendor-router';
            }
            if (id.includes('node_modules/socket.io-client') || id.includes('node_modules/engine.io-client')) {
              return 'vendor-socket';
            }
            if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
              return 'vendor-charts';
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
            proxy.on('error', () => {});
          },
        },
        '/socket.io': {
          target: backendUrl,
          ws: true,
          configure: (proxy) => {
            proxy.on('error', () => {});
          },
        },
      },
    },
  };
});
