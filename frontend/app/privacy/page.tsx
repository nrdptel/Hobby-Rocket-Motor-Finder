import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "../components/SiteHeader";

const GITHUB_ISSUES = "https://github.com/nrdptel/Hobby-Rocket-Motor-Finder/issues";

export const metadata: Metadata = {
  title: "Privacy — HPR Motor Finder",
  description:
    "What HPR Motor Finder collects (just your email, only if you opt into restock alerts), why, how long it's kept, and how to delete it.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <SiteHeader />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Privacy
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        This is a personal, non-commercial project. It tries to collect as little as possible, so
        this page is short.
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            What we collect
          </h2>
          <p className="mt-2">
            Only your <strong>email address</strong>, and only if you choose to sign up for a restock
            alert (the bell on a motor, or an alert for a saved rocket). Nothing else — no name, no
            payment details, no account.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Why, and how it works
          </h2>
          <p className="mt-2">
            Your address is used for one thing: to email you when a motor you asked about comes back
            in stock. Sign-up is <strong>double opt-in</strong> — we email a confirmation link first,
            and you&apos;re only added after you click it, so nobody can subscribe an address they
            don&apos;t control.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            What we don&apos;t do
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>No selling, renting, or sharing your address with anyone.</li>
            <li>No advertising, tracking pixels, or analytics.</li>
            <li>
              No cookies beyond a single one that remembers your light/dark theme preference.
            </li>
            <li>
              The only third parties your address touches:{" "}
              <a
                href="https://upstash.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Upstash
              </a>{" "}
              (stores your subscription) and{" "}
              <a
                href="https://www.zoho.com/zeptomail/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                ZeptoMail
              </a>{" "}
              (delivers the emails).
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            How long we keep it
          </h2>
          <p className="mt-2">
            Until you unsubscribe, or until your address hard-bounces — then it&apos;s deleted. Every
            email includes a one-click unsubscribe link, and you can view and remove all of your
            alerts at any time from the{" "}
            <Link
              href="/alerts"
              className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              manage page
            </Link>{" "}
            via a private link we email you.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Your starred motors and saved rockets
          </h2>
          <p className="mt-2">
            Those live only in your browser (local storage) and are never sent to us. Clearing your
            browser data removes them.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Contact</h2>
          <p className="mt-2">
            Questions, or want your data removed manually? Open a{" "}
            <a
              href={GITHUB_ISSUES}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              GitHub issue
            </a>{" "}
            and we&apos;ll take care of it.
          </p>
        </section>
      </div>

      <footer className="mt-10 border-t border-zinc-200 pt-5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <Link href="/" className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
          ← Back to all motors
        </Link>
      </footer>
    </main>
  );
}
