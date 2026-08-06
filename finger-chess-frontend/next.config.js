/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compress: true, // gzip on Next's own server; a reverse proxy/CDN in front should still handle this in production
  // 'standalone' traces only the files actually needed at runtime into
  // .next/standalone — the Docker image built from this (see Dockerfile)
  // is a small fraction of the size a naive `next start` image would be,
  // since it excludes the full node_modules tree and unused source files.
  output: 'standalone',
  images: {
    // No avatar/KYC image upload UI exists yet, but next/image's automatic
    // format negotiation (AVIF/WebP), responsive sizing, and lazy loading
    // by default are configured now so the first image feature added
    // doesn't ship unoptimized <img> tags before someone remembers to
    // circle back to this config.
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.amazonaws.com', // KYC/avatar uploads are stored in S3 (see backend upload.service.ts)
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Clickjacking protection — this app moves real money, so it
          // must never be embeddable in a third-party iframe that could
          // overlay invisible click targets on top of it.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://js.stripe.com", // Stripe.js requires its own origin; 'unsafe-inline' is needed for Next.js's inline bootstrap scripts
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: https:",
              "connect-src 'self' https://api.stripe.com ws: wss:", // ws:/wss: for the Socket.IO game/matchmaking namespaces
              "frame-src https://js.stripe.com https://hooks.stripe.com", // Stripe's own embedded iframes for PaymentElement
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  async rewrites() {
    // Proxies /api/* from the Next.js server to the backend so the app can
    // call same-origin relative URLs without CORS. In Kubernetes this path is
    // rarely taken — the ingress routes /api straight to the backend Service
    // (see infra/k8s/30-ingress.yaml) — but it's what makes docker-compose and
    // any non-ingress hosting work. The destination is baked at build time
    // from NEXT_PUBLIC_FINGER_CHESS_API_PROXY_TARGET (see Dockerfile).
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_FINGER_CHESS_API_PROXY_TARGET ?? 'http://localhost:3000'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
