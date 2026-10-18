/**
 * Admin access guard.
 * Location: js/admin/guard.js
 *
 * Every admin page (except login) starts with:
 *   const user = await requireAdmin();
 *
 * - No token: go to the login page, remembering where to come back to.
 * - Token present: check it with GET /auth/me. If the server rejects it
 *   (expired or invalid), clear it and go to login with a message.
 * - Any later 401 on an admin call does the same, via setOnUnauthorized.
 *
 * The page body carries class "admin-pending" until the check passes, so
 * nobody sees admin screens flash before a redirect.
 */

import { SITE_BASE } from "../config.js";
import { auth, session, setOnUnauthorized, ApiError } from "../api.js";

const LOGIN_PATH = `${SITE_BASE}admin/login.html`;
const USER_KEY = "orlu_admin_user";

/** Login URL that returns to the current page afterwards. */
export function loginUrl(reason = "") {
  const next = window.location.pathname + window.location.search;
  const params = new URLSearchParams({ next });
  if (reason) params.set("reason", reason);
  return `${LOGIN_PATH}?${params}`;
}

export function goToLogin(reason = "") {
  window.location.replace(loginUrl(reason));
}

/** The signed-in user saved after the last successful check (for instant display). */
export function cachedUser() {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

function cacheUser(user) {
  try {
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage blocked */
  }
}

export function signOut() {
  session.logout();
  try {
    sessionStorage.removeItem(USER_KEY);
  } catch {
    /* storage blocked */
  }
  window.location.replace(`${LOGIN_PATH}?reason=signed-out`);
}

/**
 * Resolve with the signed-in user, or redirect to login.
 * @returns {Promise<{id: string, email: string, is_active: boolean}>}
 */
export async function requireAdmin() {
  setOnUnauthorized(() => goToLogin("expired"));

  if (!auth.isLoggedIn()) {
    goToLogin();
    return new Promise(() => {}); // never resolves; the page is leaving
  }

  try {
    const user = await session.me();
    if (user && user.is_active === false) {
      session.logout();
      goToLogin("inactive");
      return new Promise(() => {});
    }
    cacheUser(user);
    document.body.classList.remove("admin-pending");
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // onUnauthorized already redirected.
      return new Promise(() => {});
    }
    // Server down or network error: show the page with a banner rather
    // than throwing the admin out. Calls will fail with their own messages.
    document.body.classList.remove("admin-pending");
    const user = cachedUser();
    document.body.dataset.offline = "true"; // layout.js shows a banner
    window.dispatchEvent(new CustomEvent("admin:offline", { detail: error }));
    return user || { email: "", is_active: true };
  }
}

/** Safe "next" target from the login URL: only admin pages on this site. */
export function safeNext(raw) {
  if (!raw) return `${SITE_BASE}admin/index.html`;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return `${SITE_BASE}admin/index.html`;
    if (!url.pathname.startsWith(`${SITE_BASE}admin/`) || url.pathname === LOGIN_PATH) return `${SITE_BASE}admin/index.html`;
    return url.pathname + url.search;
  } catch {
    return `${SITE_BASE}admin/index.html`;
  }
}
