"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const KEY = "hpr.theme";
const ORDER: Theme[] = ["system", "light", "dark"];
const LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
const ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Apply a theme to the document: toggle the `.dark` class (which drives every
 * `dark:` utility) and the native `color-scheme` (scrollbars, form controls).
 * Mirrors the inline script in layout.tsx, which applies the stored choice
 * before first paint; this keeps it in sync afterward. */
function apply(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && systemDark());
  const e = document.documentElement;
  e.classList.toggle("dark", dark);
  e.style.colorScheme = dark ? "dark" : "light";
}

/** Cycles System → Light → Dark, persisted in localStorage. The inline script
 * in layout.tsx applies the stored choice before first paint; this keeps it in
 * sync afterward and re-applies on OS changes while in System mode. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(KEY) as Theme | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      setTheme(stored);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage disabled/full — apply() still themes this session */
    }
    apply(theme);
  }, [theme, mounted]);

  useEffect(() => {
    if (!mounted || theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, mounted]);

  const cycle = () => setTheme((t) => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]);

  // Render a theme-agnostic placeholder until mounted so the first client paint
  // matches the server HTML (the actual theme is already applied to <html> by
  // the inline script, independent of this button's label).
  const shown: Theme = mounted ? theme : "system";

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${LABEL[shown]} (click to change)`}
      aria-label={`Color theme: ${LABEL[shown]}. Click to change.`}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <span aria-hidden className="text-sm leading-none">
        {ICON[shown]}
      </span>
      {LABEL[shown]}
    </button>
  );
}
