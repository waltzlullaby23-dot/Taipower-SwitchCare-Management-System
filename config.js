/*
 * SwitchCare Enterprise v8
 *
 * This file is intentionally the only place where the browser-side
 * Supabase connection settings are kept.
 *
 * Use ONLY:
 *   SUPABASE_URL: https://<your-project-ref>.supabase.co
 *   SUPABASE_PUBLISHABLE_KEY: sb_publishable_...
 *
 * Never put sb_secret_... or service_role in GitHub Pages.
 */
window.SWITCHCARE_CONFIG = {
  SUPABASE_URL: "https://nmqnhzhqjwlbywqsaiwt.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "請貼上你的完整_sb_publishable_Key",
  COMPANY_NAME: "台電",
  CYCLE_MONTHS: 6,
  REMIND_DAYS: 30,
  SESSION_STORAGE_KEY: "switchcare_session_v8"
};
