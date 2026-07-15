/** @type {import('next').NextConfig} */

// ── Security: hide "X-Powered-By: Next.js" fingerprint ──────────────────────
// This removes the header that tells scanners and attackers which framework
// and version is running on this API server.

const nextConfig = {
  output: "standalone",
  // ── Security: suppress X-Powered-By header ──────────────────────────────
  poweredByHeader: false,

  // AWS SDK to prevent hashed module 
  transpilePackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/client-connect",
    "@aws-sdk/client-transcribe",
    "@aws-sdk/s3-request-presigner",
    "aws-sdk",
    "pg"
  ],

  // ── Security: hardened HTTP response headers for all API routes ──────────
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Anti-clickjacking — API responses should never be framed
          { key: "X-Frame-Options", value: "DENY" },
          // MIME-sniffing protection — prevent browsers from guessing content type
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer leakage reduction
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // HSTS — instructs browsers to only use HTTPS for 1 year
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          // Cross-domain policy — blocks Flash/PDF cross-domain read abuse
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
        ],
      },
    ];
  },
};

export default nextConfig;
