import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'leIA · Entrevistas Meet',
  description: 'Sistema v2.0 de entrevistas automáticas en Google Meet con leIA y Recall.ai.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
