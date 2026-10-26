import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '低延遲直播平台',
  description: '兩個人隔著不同網路，合唱一首歌',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-neutral-950 text-neutral-100">
        {children}
      </body>
    </html>
  );
}
