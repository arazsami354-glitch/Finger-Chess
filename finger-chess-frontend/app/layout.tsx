import type { Metadata } from 'next';
import { Sora, Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { Toaster } from 'sonner';
import './globals.css';

const sora = Sora({ subsets: ['latin'], variable: '--font-sora', weight: ['500', '600', '700'] });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', weight: ['400', '500', '600'] });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', weight: ['400', '500', '600'] });

export const metadata: Metadata = {
  title: 'Finger Chess | Play Competitive Chess Online',
  description:
    'Finger Chess is a premium online chess platform where players compete in real-time matches for real money — choose a stake, play a fair match, and the winner takes the prize.',
  applicationName: 'Finger Chess',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sora.variable} ${inter.variable} ${jetbrainsMono.variable} font-body`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <AuthProvider>
            {children}
            <Toaster
              richColors
              position="top-right"
              theme="dark"
              toastOptions={{
                classNames: {
                  toast: '!rounded-xl !border !border-border !shadow-premium',
                  title: '!text-sm !font-medium',
                  description: '!text-xs',
                },
              }}
            />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
