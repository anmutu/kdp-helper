import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "纸间 · KDP 绘本工作台",
  description: "作者自己的本地绘本印刷工作台：规格、内容、选图、排版与出版文件。",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
