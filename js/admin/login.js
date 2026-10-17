/**
 * Admin sign-in.
 * Location: js/admin/login.js   (loaded by admin/login.html)
 *
 * POST /auth/login with { email, password } -> { access_token }.
 * After signing in, goes to ?next= (an admin page) or the dashboard.
 */

import { api, auth, session, ApiError } from "../api.js";
import { safeNext } from "./guard.js";

const params = new URLSearchParams(window.location.search);
const next = safeNext(params.get("next"));

const els = {
  form: document.querySelector("[data-login-form]"),
  email: document.querySelector("#email"),
  password: document.querySelector("#password"),
  remember: document.querySelector("[data-remember]"),
  submit: document.querySelector("[data-submit]"),
  toggle: document.querySelector("[data-toggle-password]"),
  notice: document.querySelector("[data-notice]"),
  slow: document.querySelector("[data-slow]"),
  name: document.querySelector("[data-community-name]"),
};

/* ---------------- Messages ---------------- */

const REASONS = {
  expired: { kind: "warn", text: "Your session has ended. Please sign in again." },
  "signed-out": { kind: "ok", text: "You've been signed out." },
  inactive: { kind: "error", text: "This account has been deactivated. Contact the site owner." },
};

function showNotice(kind, text) {
  els.notice.className = `notice notice--${kind}`;
  els.notice.textContent = text;
  els.notice.hidden = false;
}

function setFieldError(name, message) {
  const input = els[name];
  const error = document.querySelector(`[data-error-for="${name}"]`);
  if (message) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", `${name}-error`);
    error.id = `${name}-error`;
    error.textContent = message;
    error.hidden = false;
  } else {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    error.hidden = true;
  }
}

function validate() {
  const email = els.email.value.trim();
  const password = els.password.value;
  let ok = true;

  if (!email) {
    setFieldError("email", "Enter your email address.");
    ok = false;
  } else if (!els.email.checkValidity()) {
    setFieldError("email", "Enter a valid email address, like name@example.com.");
    ok = false;
  } else {
    setFieldError("email", "");
  }

  if (!password) {
    setFieldError("password", "Enter your password.");
    ok = false;
  } else {
    setFieldError("password", "");
  }

  if (!ok) (els.email.getAttribute("aria-invalid") ? els.email : els.password).focus();
  return ok;
}

function setBusy(busy) {
  els.submit.disabled = busy;
  els.submit.textContent = busy ? "Signing in…" : "Sign in";
  els.form.setAttribute("aria-busy", String(busy));
}

/* ---------------- Sign in ---------------- */

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.notice.hidden = true;
  if (!validate()) return;

  setBusy(true);
  const slowTimer = setTimeout(() => (els.slow.hidden = false), 4000);

  try {
    await session.login(els.email.value.trim(), els.password.value, { remember: els.remember.checked });
    window.location.replace(next);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 400 || error.status === 403)) {
      showNotice("error", "That email and password don't match. Check them and try again.");
      els.password.value = "";
      els.password.focus();
    } else if (error instanceof ApiError && error.status === 422) {
      const fields = error.fieldErrors;
      if (fields.email) setFieldError("email", fields.email);
      if (fields.password) setFieldError("password", fields.password);
      if (!fields.email && !fields.password) showNotice("error", error.message);
    } else {
      showNotice("error", error.message || "Couldn't sign in. Please try again.");
    }
  } finally {
    clearTimeout(slowTimer);
    els.slow.hidden = true;
    setBusy(false);
  }
});

/* ---------------- Show / hide password ---------------- */

els.toggle.addEventListener("click", () => {
  const showing = els.password.type === "text";
  els.password.type = showing ? "password" : "text";
  els.toggle.textContent = showing ? "Show" : "Hide";
  els.toggle.setAttribute("aria-pressed", String(!showing));
  els.password.focus();
});

/* ---------------- On load ---------------- */

const reason = REASONS[params.get("reason")];
if (reason) showNotice(reason.kind, reason.text);

// Already signed in with a working token? Skip the form.
if (auth.isLoggedIn() && !reason) {
  session
    .me()
    .then(() => window.location.replace(next))
    .catch(() => auth.clearToken());
}

// Community name on the card, and it wakes the server before the person submits.
api
  .getSite()
  .then((site) => {
    if (site?.community_name) {
      els.name.textContent = site.community_name;
      document.title = `Sign in | ${site.community_name} admin`;
    }
  })
  .catch(() => {});

els.email.focus();
