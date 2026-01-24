import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "🛳️ Ship It",
  description: "A Linear-style issue tracker with keyboard-first navigation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        <AuthKitProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}
