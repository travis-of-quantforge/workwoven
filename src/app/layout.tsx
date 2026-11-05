import type { Metadata } from "next";
import "@bryntum/gantt-enterprise/gantt.css";
import "@bryntum/calendar-enterprise/calendar.thin.css";
import "@bryntum/core-enterprise/svalbard-light.css";
import "@bryntum/core-enterprise/fontawesome/css/fontawesome.css";
import "@bryntum/core-enterprise/fontawesome/css/solid.css";
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
