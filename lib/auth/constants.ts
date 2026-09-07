/** Edge-safe constants (no Node APIs) — importable from middleware. */
export const SESSION_COOKIE = "lifeos_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** App routes that require a session. Marketing/auth/api stay public. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/projects",
  "/crm",
  "/finance",
  "/analytics",
  "/assistant",
  "/billing",
  "/settings",
  "/team",
];
