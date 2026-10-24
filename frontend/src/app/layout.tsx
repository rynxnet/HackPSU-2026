import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ResearchIDE - Academic Research Workspace",
  description: "An IDE-style workspace for academic research with grounded Gemini AI reasoning, vector citations, and dataset preview.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground overflow-hidden h-screen select-none">
        {children}
      </body>
    </html>
  );
}
