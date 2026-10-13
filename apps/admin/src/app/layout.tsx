import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';

import AuthWrapper from '@/components/AuthWrapper';


export const metadata: Metadata = {
  title: 'Hackathon Team API Admin',
  description: 'Manage team API keys, dollar credit, and model usage.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans flex overflow-hidden bg-background text-foreground transition-colors duration-300">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthWrapper>
            {children}
          </AuthWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
