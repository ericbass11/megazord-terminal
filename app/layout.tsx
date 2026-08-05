import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: {
    default: `${SITE.name} — o ADE que comanda seu time de IAs`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.promise,
  openGraph: {
    title: `${SITE.name} — Agentic Development Environment`,
    description: SITE.promise,
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
