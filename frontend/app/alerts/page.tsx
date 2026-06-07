import type { Metadata } from "next";
import Link from "next/link";
import { ManageAlertsForm } from "../components/ManageAlertsForm";
import { SiteHeader } from "../components/SiteHeader";

const ALERTS_ON = process.env.NEXT_PUBLIC_ALERTS_ENABLED === "1";

export const metadata: Metadata = {
  title: "Manage email alerts — HPR Motor Finder",
  description: "View and unsubscribe from your motor restock email alerts.",
  robots: { index: false, follow: false },
};

export default function AlertsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <SiteHeader />
      <Link
        href="/"
        className="mt-4 inline-block text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        ← Back to HPR Motor Finder
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Manage email alerts
      </h1>

      {ALERTS_ON ? (
        <>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Enter your email and we&apos;ll send a private link to view every motor
            you&apos;re subscribed to, where you can unsubscribe from any or all of them.
            No restock needed.
          </p>
          <p className="mt-2 max-w-prose text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
            For your privacy, we always show the same message and never reveal whether an
            address is subscribed — your list opens only from the link we email you. See our{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              privacy page
            </Link>{" "}
            for what we collect and how to delete it.
          </p>
          <div className="mt-5">
            <ManageAlertsForm />
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Email alerts aren&apos;t enabled on this deployment.
        </p>
      )}
    </main>
  );
}
