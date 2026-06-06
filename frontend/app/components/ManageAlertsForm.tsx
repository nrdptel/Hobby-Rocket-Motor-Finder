"use client";

import { useEffect, useState, type FormEvent } from "react";

// "Manage my alerts" entry form. Enter an email → we email a magic link to view
// and unsubscribe from your alerts. The response is intentionally always the
// same ("if that address has alerts…") so the page can't be used to discover
// whether an address is subscribed.

const EMAIL_KEY = "hpr.alertEmail";

type Status = "idle" | "sending" | "sent" | "error";

export function ManageAlertsForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(EMAIL_KEY);
      if (saved) setEmail(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === "sending") return; // guard Enter-key re-submit
    const addr = email.trim();
    setStatus("sending");
    setMessage("");
    try {
      const res = await fetch("/api/alerts/manage-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: addr }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        try {
          localStorage.setItem(EMAIL_KEY, addr);
        } catch {
          /* ignore */
        }
        setStatus("sent");
        setMessage(data?.message || "If that address has any alerts, we've emailed a link.");
      } else {
        setStatus("error");
        setMessage(data?.error || "Something went wrong. Try again.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Try again.");
    }
  };

  if (status === "sent") {
    return (
      <p
        role="status"
        aria-live="polite"
        className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      >
        ✓ {message} The link works for about an hour.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        aria-label="Your email address"
        className="w-56 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-md border border-zinc-900 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {status === "sending" ? "Sending…" : "Email me a link"}
      </button>
      {status === "error" && (
        <span role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
          {message}
        </span>
      )}
    </form>
  );
}
