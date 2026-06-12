// localStorage key the alert components remember the visitor's email under, so
// the per-motor NotifyButton, the per-rocket RocketNotifyButton, and the manage
// page all prefill the same address. Kept in its own client-safe module (no
// server env imports) so every component shares one source of truth.
export const ALERT_EMAIL_KEY = "hpr.alertEmail";
