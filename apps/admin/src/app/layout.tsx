import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import { ThemeProvider } from '@/components/ThemeProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Claude Hackathon Admin',
  description: 'Manage participants, tokens, and agent queues.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} flex overflow-hidden bg-background text-foreground transition-colors duration-300`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Sidebar />
          <main className="flex-1 overflow-y-auto p-4 pl-0">
            <div className="glass-panel min-h-full p-8 rounded-2xl">
              {children}
            </div>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
