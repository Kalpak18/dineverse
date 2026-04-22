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
        strategies: 'generateSW',
        workbox: {
          // Network-first for navigation (always get latest HTML)
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          // Cache hashed assets forever (they change name on update)
          runtimeCaching: [
            {
              urlPattern: /\/assets\/.+\.(js|css|woff2?)$/,
              handler: 'CacheFirst',
              options: { cacheName: 'assets', expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 } },
            },
            {
              urlPattern: /\/icons\/.+\.(png|ico|svg)$/,
              handler: 'CacheFirst',
              options: { cacheName: 'icons', expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } },
            },
          ],
          cleanupOutdatedCaches: true,
          skipWaiting: true, // activate new SW immediately; main.jsx reloads on controllerchange
          clientsClaim: true,
        },
        manifest: false, // we already have public/site.webmanifest
      }),
    ],
    build: {
      rollupOptions: {
        // Capacitor native plugin — not installed in web/CI builds, only resolved at runtime on device
        external: ['@capacitor-community/barcode-scanner'],
        output: {
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
