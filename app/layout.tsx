import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '新能源企业法务合同审查助手',
  description: '面向新能源设备采购、储能、光伏、锂电和 EPC 业务的合同审查辅助程序。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
