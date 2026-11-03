import type { Metadata } from "next";
import "./globals.css";
import { Header, Footer } from "../components/Header";
import { ToastSetup } from "../components/Toasts";
import { WalletSetup } from "../components/Wallet";
import { DeployBanner } from "../components/ui";

export const metadata: Metadata = {
  title: "PATCHPAY — Code ships. Payment follows.",
  description:
    "GitHub bounties held in NEAR escrow. Payment releases only when a TEE-verified merge proves the work landed.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ToastSetup>
          <WalletSetup>
            <DeployBanner />
            <Header />
            <main className="min-h-[70vh]">{children}</main>
            <Footer />
          </WalletSetup>
        </ToastSetup>
      </body>
    </html>
  );
}
