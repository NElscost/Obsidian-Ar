import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Space AR · Meta Quest",
  description:
    "Visualize o grafo Space em realidade aumentada com WebXR, hit test, anchors e gestos de mão.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
