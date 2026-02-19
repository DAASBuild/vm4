import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VerifiedMeasure — Governed Data Access',
  description: 'Enterprise-grade credential access to curated data products.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
