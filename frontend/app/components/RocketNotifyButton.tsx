"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { BellIcon } from "./BellIcon";

// Per-rocket "email me when ANYTHING that fits this rocket comes back in stock".
// One subscription covers every compatible motor, present and future — no need
// to bell each motor. Renders only when alerts are configured
// (NEXT_PUBLIC_ALERTS_ENABLED === "1"). The email is remembered in localStorage,
// shared with the per-motor NotifyButton.

const ALERTS_ON = process.env.NEXT_PUBLIC_ALERTS_ENABLED === "1";
const EMAIL_KEY = "hpr.alertEmail";

type Status = "idle" | "sending" | "sent" | "error";

export function RocketNotifyButton({
  name,
  displayLabel,
  diameterMm,
  cert,
  impulseClass,
  caseInfo,
  minImpulseNs,
  maxImpulseNs,
  active,
}: {
  name: string;
  displayLabel: string;
  diameterMm: number;
  cert: string | null;
  impulseClass: string | null;
  caseInfo: string | null;
  minImpulseNs: number | null;
  maxImpulseNs: number | null;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      try {
        const saved = localStorage.getItem(EMAIL_KEY);
        if (saved) setEmail(saved);
      } catch {
        /* ignore */
      }
      inputRef.current?.focus();
    }
  }, [open]);

  if (!ALERTS_ON) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === "sending") return; // guard Enter-key re-submit
    const addr = email.trim();
    setStatus("sending");
    setMessage("");
    try {
      const res = await fetch("/api/alerts/subscribe-rocket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: addr,
          label: name,
          diameterMm,
          cert,
          impulseClass,
          caseInfo,
          minImpulseNs,
          maxImpulseNs,
        }),
      });
      if (res.ok) {
        try {
          localStorage.setItem(EMAIL_KEY, addr);
        } catch {
          /* ignore */
        }
        setStatus("sent");
      } else {
        const data = await res.json().catch(() => ({}));
        setStatus("error");
        setMessage(data?.error || "Something went wrong. Try again.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Try again.");
    }
  };

  const edge = active
    ? "text-zinc-300 hover:text-white"
    : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200";

  // Persistent live region so screen readers reliably announce the outcome.
  const liveMsg =
    status === "sent" ? "Check your email to confirm." : status === "error" ? message : "";
  const liveRegion = (
    <span className="sr-only" role="status" aria-live="polite">
      {liveMsg}
    </span>
  );

  if (!open) {
    return (
      <>
        {liveRegion}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Email me when anything that fits ${displayLabel} is back in stock`}
          title="Email me when anything that fits this rocket restocks"
          className={`ml-1 shrink-0 cursor-pointer p-1 leading-none transition ${edge}`}
        >
          <BellIcon className="h-4 w-4" />
        </button>
      </>
    );
  }

  if (status === "sent") {
    return (
      <>
        {liveRegion}
        <span className="ml-1 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          ✓ Check your email
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setStatus("idle");
            }}
            aria-label="Close"
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            ×
          </button>
        </span>
      </>
    );
  }

  return (
    <>
      {liveRegion}
      <form onSubmit={submit} className="ml-1 inline-flex flex-wrap items-center gap-1">
        <input
          ref={inputRef}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          aria-label={`Email for ${displayLabel} restock alerts`}
          className="w-36 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-md border border-zinc-900 bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {status === "sending" ? "…" : "Alert me"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setStatus("idle");
          }}
          aria-label="Cancel"
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          ×
        </button>
        {status === "error" && (
          <span className="text-xs text-red-600 dark:text-red-400">{message}</span>
        )}
        <span className="basis-full text-[10px] leading-tight text-zinc-400 dark:text-zinc-500">
          Double opt-in — we&apos;ll email a confirmation, address used only for restock alerts.{" "}
          <Link
            href="/privacy"
            className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Privacy
          </Link>
        </span>
      </form>
    </>
  );
}
