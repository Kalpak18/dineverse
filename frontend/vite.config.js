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
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons/*.svg'],
        manifest: {
          name: 'DineVerse',
          short_name: 'DineVerse',
          description: 'Order food, book tables, and track your orders — all from your phone.',
          theme_color: '#f97316',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          lang: 'en',
          categories: ['food', 'lifestyle'],
          icons: [
            { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
            { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
            { src: '/icons/icon-maskable.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
          ],
          shortcuts: [
            {
              name: 'Explore Cafés',
              short_name: 'Explore',
              description: 'Browse cafés near you',
              url: '/explore',
              icons: [{ src: '/icons/icon-192.svg', sizes: '192x192' }],
            },
          ],
        },
        workbox: {
          // Cache static assets aggressively
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
          // Network-first for API and socket (always live)
          runtimeCaching: [
            {
              urlPattern: /^\/api\//,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^\/socket\.io\//,
              handler: 'NetworkOnly',
            },
            // Cache Google Fonts
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
            // Razorpay checkout — network only
            {
              urlPattern: /^https:\/\/checkout\.razorpay\.com\//,
              handler: 'NetworkOnly',
            },
          ],
          // Skip waiting so new SW activates immediately
          skipWaiting: true,
          clientsClaim: true,
        },
        devOptions: {
          enabled: false, // don't run SW in dev (avoids cache confusion)
        },
      }),
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
