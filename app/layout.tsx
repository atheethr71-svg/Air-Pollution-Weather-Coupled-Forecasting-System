import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QueueMind AI – Smart Queue Monitoring & Predictive Management System',
  description: 'Enterprise Browser-based AI Operations Agent & Real-time Queue Intelligence for Hospitals, Canteens, Banks, and Clinics.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
