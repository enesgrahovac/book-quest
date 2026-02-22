import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Book Quest",
  description: "Self-paced AI tutoring for lifelong learners"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
