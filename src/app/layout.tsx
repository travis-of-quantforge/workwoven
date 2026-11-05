import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME || "Workspace",
  description:
    "A shared space for clear agreements and thoughtful collaboration.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
