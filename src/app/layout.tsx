import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  title: "FlexFit Studio",
  description: "Class booking and membership management for FlexFit Studio.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="relative min-h-screen overflow-x-hidden">
        {/* Global Environmental Background Layer */}
        <div 
          className="fixed inset-0 z-0 pointer-events-none"
          style={{
            backgroundImage: "url('/background.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center 30%",
            backgroundRepeat: "no-repeat",
            filter: "blur(30px) brightness(0.35) contrast(1.1)",
            transform: "scale(1.1)", // Prevents blur edge artifacts at viewport boundaries
          }}
        />
        {/* Environmental Ambient Overlay */}
        <div className="fixed inset-0 z-0 bg-black bg-opacity-40 pointer-events-none" />

        <Providers>
          <div className="relative z-10 flex flex-col min-h-screen">
            <NavBar />
            <main className="mx-auto max-w-5xl w-full px-6 py-10 flex-1">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
