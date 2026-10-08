import type { Metadata, Viewport } from 'next';
import '@/styles/index.css';

export const metadata: Metadata = {
  title: 'BreachLoop | Incident Response Simulator',
  description:
    'AI-assisted cloud incident-response simulator: reconstruct attack paths from synthetic CloudTrail events and prove remediations in a digital twin.',
  applicationName: 'BreachLoop',
  keywords: ['incident response', 'cloud security', 'digital twin', 'cloudtrail', 'SOC console'],
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0b0d12',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Fonts are loaded with plain <link> tags rather than next/font on
          purpose: next/font fetches at build time, which makes `next build` fail
          in any environment without outbound access to Google Fonts (CI
          sandboxes, air-gapped runners, Vercel edge builds with network
          isolation). The browser fetch stays lazy and non-blocking, and every
          font-family in styles/index.css has a full local fallback stack.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* App Router has no custom document; the root layout *is* the single
            place fonts load, so this pages-router rule does not apply. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
