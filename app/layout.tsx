import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "10xCatDad // ART & STUFF", description: "Art and visual experiments by 10xCatDad.", icons: { icon: "/favicon.svg" } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
 return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('art-theme')||'system'}catch{}" }} /></head><body>{children}</body></html>;
}
