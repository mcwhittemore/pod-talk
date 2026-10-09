import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { isLoggedIn } from "@/lib/auth";

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME ?? "Pod Talk",
  description: "Listen queue, transcripts and conversations for Pod Talk",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const loggedIn = await isLoggedIn();
  return (
    <html lang="en">
      <body>
        <Nav loggedIn={loggedIn} appName={process.env.NEXT_PUBLIC_APP_NAME ?? "Pod Talk"} />
        <main>{children}</main>
      </body>
    </html>
  );
}
