"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

// Per-motor "email me when it's back in stock". Renders only when alerts are
// configured (NEXT_PUBLIC_ALERTS_ENABLED === "1") — otherwise it's nothing, so
// the site works unchanged without the alert backend. The email is remembered
// in localStorage so it's one field, prefilled, after the first time.

const ALERTS_ON = process.env.NEXT_PUBLIC_ALERTS_ENABLED === "1";
const EMAIL_KEY = "hpr.alertEmail";

type Status = "idle" | "sending" | "sent" | "error";

export function NotifyButton({
  manufacturer,
  designation,
}: {
  manufacturer: string;
  designation: string;
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
    if (status === "sending") return; // guard Enter-key re-submit (disabled blocks only clicks)
    const addr = email.trim();
    setStatus("sending");
    setMessage("");
    try {
      const res = await fetch("/api/alerts/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: addr, manufacturer, designation }),
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Email me when ${designation} is back in stock`}
        aria-expanded={open}
        title="Email me when this is back in stock"
        className="shrink-0 cursor-pointer p-1.5 -m-1.5 text-sm leading-none text-zinc-400 transition hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300"
      >
        🔔
      </button>
    );
  }

  if (status === "sent") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
      >
        ✓ Check your email to confirm
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
    );
  }

  return (
    <form onSubmit={submit} className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        aria-label={`Email for ${designation} restock alert`}
        className="w-40 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-md border border-zinc-900 bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {status === "sending" ? "…" : "Notify me"}
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
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {message}
        </span>
      )}
    </form>
  );
}
