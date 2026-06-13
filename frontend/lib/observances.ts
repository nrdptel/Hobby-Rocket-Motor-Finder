// Monthly observances — small, tasteful flourishes the site shows during the
// months they fall in (a thin accent rule at the top of the page and a warm
// line in the footer), in the spirit of a Google Doodle. Multiple observances
// can share a month (June is both Pride and Men's Mental Health Month), so each
// month maps to a list and every active one renders.
//
// Curated toward observances that genuinely need awareness — a mix of health /
// mental-health causes and heritage / identity months — each with a real,
// reputable resource link (U.S.-centric, matching the site's audience).
//
// It switches automatically: evaluated from `new Date()` at render time, and the
// pages that use it are static / ISR (revalidate 60s), so an observance appears
// and disappears within a revalidation window of the month rolling over — no
// per-request work and no manual toggling.

export type Observance = {
  /** Stable key (for React lists). */
  id: string;
  /** Leading emoji for the footer line. */
  emoji: string;
  /** Warm one-line footer message. */
  message: string;
  /** Optional supportive/resource link shown after the message. */
  href?: string;
  /** Visible label for the link (an arrow is appended in the UI). */
  hrefLabel?: string;
  /** Optional thin accent rule at the top of the page. `background` is any CSS
   *  background value; `title` is the hover/AT tooltip (the bar is aria-hidden). */
  bar?: { background: string; title: string };
};

// Accent backgrounds — each keyed to the observance's recognized ribbon/flag colour.
const PRIDE = "linear-gradient(to right, #e40303, #ff8c00, #ffed00, #008026, #004dff, #750787)";
const MENS_MH = "linear-gradient(to right, #34d399, #059669)"; // emerald — the site's own accent
const BLOOD = "linear-gradient(to right, #dc2626, #991b1b)"; // red
const PAN_AFRICAN = "linear-gradient(to right, #e31b23, #111111, #00853f)"; // red / black / green
const SUFFRAGE_PURPLE = "linear-gradient(to right, #7c3aed, #6d28d9)";
const AUTISM_GOLD = "linear-gradient(to right, #f59e0b, #d97706)"; // gold "infinity"
const MH_GREEN = "linear-gradient(to right, #22c55e, #15803d)"; // green ribbon
const DISABILITY_PRIDE = "linear-gradient(to right, #c44d4d, #e8b73a, #e8e8e8, #4c8fb5, #4caf50)";
const OVERDOSE_PURPLE = "linear-gradient(to right, #9333ea, #7e22ce)";
const SUICIDE_TEAL_PURPLE = "linear-gradient(to right, #14b8a6, #8b5cf6)"; // teal & purple ribbon
const BREAST_PINK = "linear-gradient(to right, #ec4899, #db2777)";
const NATIVE_EARTH = "linear-gradient(to right, #1ba39c, #d97742)"; // turquoise → terracotta
const AIDS_RED = "linear-gradient(to right, #e11d48, #be123c)"; // the original red ribbon
const HEART_RED = "linear-gradient(to right, #ef4444, #b91c1c)"; // American Heart Month
const SAAM_TEAL = "linear-gradient(to right, #14b8a6, #0d9488)"; // sexual-assault-awareness teal ribbon
const AAPI_WARM = "linear-gradient(to right, #e11d48, #fb923c)"; // AAPI heritage
const HISPANIC_FIESTA = "linear-gradient(to right, #f43f5e, #f59e0b, #fcd34d)"; // Hispanic heritage
const DV_PURPLE = "linear-gradient(to right, #9333ea, #6d28d9)"; // domestic-violence purple ribbon
const MOVEMBER_BLUE = "linear-gradient(to right, #2563eb, #1d4ed8)"; // Movember men's health

// Keyed by month index (0 = January … 11 = December).
const OBSERVANCES: Record<number, Observance[]> = {
  0: [
    {
      id: "blood-donor",
      emoji: "🩸",
      message: "National Blood Donor Month — give blood, save lives.",
      href: "https://www.redcrossblood.org",
      hrefLabel: "Red Cross",
      bar: { background: BLOOD, title: "National Blood Donor Month 🩸" },
    },
  ],
  1: [
    {
      id: "black-history",
      emoji: "✊🏿",
      message: "Black History Month — celebrating Black history, culture, and achievement.",
      href: "https://nmaahc.si.edu",
      hrefLabel: "Museum of African American History",
      bar: { background: PAN_AFRICAN, title: "Black History Month ✊🏿" },
    },
    {
      id: "american-heart",
      emoji: "❤️",
      message: "American Heart Month — look after your heart.",
      href: "https://www.heart.org",
      hrefLabel: "American Heart Association",
      bar: { background: HEART_RED, title: "American Heart Month ❤️" },
    },
  ],
  2: [
    {
      id: "womens-history",
      emoji: "♀️",
      message: "Women's History Month — honoring the women who've shaped our world.",
      href: "https://www.womenshistory.org",
      hrefLabel: "Women's History Museum",
      bar: { background: SUFFRAGE_PURPLE, title: "Women's History Month ♀️" },
    },
  ],
  3: [
    {
      id: "autism-acceptance",
      emoji: "♾️",
      message: "Autism Acceptance Month — celebrating neurodiversity.",
      href: "https://autisticadvocacy.org",
      hrefLabel: "ASAN",
      bar: { background: AUTISM_GOLD, title: "Autism Acceptance Month ♾️" },
    },
    {
      id: "sexual-assault-awareness",
      emoji: "💙",
      message: "Sexual Assault Awareness Month — support survivors, end the silence.",
      href: "https://www.rainn.org",
      hrefLabel: "RAINN",
      bar: { background: SAAM_TEAL, title: "Sexual Assault Awareness Month 💙" },
    },
  ],
  4: [
    {
      id: "mental-health",
      emoji: "💚",
      message: "Mental Health Awareness Month — it's okay to ask for help.",
      href: "https://www.nami.org",
      hrefLabel: "NAMI",
      bar: { background: MH_GREEN, title: "Mental Health Awareness Month 💚" },
    },
    {
      id: "aapi-heritage",
      emoji: "🌏",
      message: "AAPI Heritage Month — celebrating Asian American & Pacific Islander communities.",
      href: "https://asianpacificheritage.gov",
      hrefLabel: "Asian Pacific Heritage",
      bar: { background: AAPI_WARM, title: "AAPI Heritage Month 🌏" },
    },
  ],
  5: [
    {
      id: "pride",
      emoji: "🏳️‍🌈",
      message: "Happy Pride Month — fly high.",
      href: "https://www.thetrevorproject.org",
      hrefLabel: "The Trevor Project",
      bar: { background: PRIDE, title: "Happy Pride Month 🏳️‍🌈" },
    },
    {
      id: "mens-mental-health",
      emoji: "💚",
      message: "June is Men's Mental Health Month — you're not flying solo.",
      href: "https://988lifeline.org",
      hrefLabel: "988 Lifeline",
      bar: { background: MENS_MH, title: "Men's Mental Health Month 💚" },
    },
  ],
  6: [
    {
      id: "disability-pride",
      emoji: "♿",
      message: "Disability Pride Month — celebrating disability identity and access for all.",
      href: "https://www.ada.gov",
      hrefLabel: "ADA.gov",
      bar: { background: DISABILITY_PRIDE, title: "Disability Pride Month ♿" },
    },
  ],
  7: [
    {
      id: "overdose-awareness",
      emoji: "💜",
      message: "International Overdose Awareness — end the stigma, save lives.",
      href: "https://www.samhsa.gov/find-help",
      hrefLabel: "SAMHSA help",
      bar: { background: OVERDOSE_PURPLE, title: "International Overdose Awareness 💜" },
    },
  ],
  8: [
    {
      id: "suicide-prevention",
      emoji: "💛",
      message: "Suicide Prevention Month — you matter, and help is here.",
      href: "https://988lifeline.org",
      hrefLabel: "988 Lifeline",
      bar: { background: SUICIDE_TEAL_PURPLE, title: "Suicide Prevention Month 💛" },
    },
    {
      id: "hispanic-heritage",
      emoji: "🌎",
      message: "Hispanic Heritage Month — celebrating Hispanic & Latino cultures and contributions.",
      href: "https://www.hispanicheritagemonth.gov",
      hrefLabel: "Hispanic Heritage",
      bar: { background: HISPANIC_FIESTA, title: "Hispanic Heritage Month 🌎" },
    },
  ],
  9: [
    {
      id: "breast-cancer",
      emoji: "🎀",
      message: "Breast Cancer Awareness Month — early detection saves lives.",
      href: "https://www.komen.org",
      hrefLabel: "Susan G. Komen",
      bar: { background: BREAST_PINK, title: "Breast Cancer Awareness Month 🎀" },
    },
    {
      id: "domestic-violence-awareness",
      emoji: "💜",
      message: "Domestic Violence Awareness Month — you're not alone; help is confidential.",
      href: "https://www.thehotline.org",
      hrefLabel: "The Hotline",
      bar: { background: DV_PURPLE, title: "Domestic Violence Awareness Month 💜" },
    },
  ],
  10: [
    {
      id: "native-american-heritage",
      emoji: "🪶",
      message: "Native American Heritage Month — honoring Indigenous peoples and cultures.",
      href: "https://americanindian.si.edu",
      hrefLabel: "Museum of the American Indian",
      bar: { background: NATIVE_EARTH, title: "Native American Heritage Month 🪶" },
    },
    {
      id: "movember",
      emoji: "💙",
      message: "Movember — men's health: prostate & testicular cancer, and mental health.",
      href: "https://movember.com",
      hrefLabel: "Movember",
      bar: { background: MOVEMBER_BLUE, title: "Movember 💙" },
    },
  ],
  11: [
    {
      id: "world-aids-day",
      emoji: "🎗️",
      message: "World AIDS Day — remember, support, and end HIV stigma.",
      href: "https://www.hiv.gov/world-aids-day",
      hrefLabel: "HIV.gov",
      bar: { background: AIDS_RED, title: "World AIDS Day 🎗️" },
    },
  ],
};

/** Observances active for the given date (defaults to now), in display order. */
export function observancesForDate(date: Date = new Date()): Observance[] {
  return OBSERVANCES[date.getMonth()] ?? [];
}
