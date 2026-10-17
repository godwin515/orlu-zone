/**
 * Small UI pieces shared by admin pages.
 * Location: js/admin/admin-ui.js
 *
 *   confirmDialog({...})  -> Promise<boolean>   (e.g. "Delete this post?")
 *   toast("Post deleted")                        (short message, bottom of screen)
 *   statusTag("draft")                           (coloured status label)
 */

import { escapeHtml } from "../ui.js";

/* ---------------- Status tags ---------------- */

const STATUS_LABELS = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
};

export function statusTag(status) {
  const label = STATUS_LABELS[status] || status || "Unknown";
  return `<span class="tag tag--${escapeHtml(status || "draft")}">${escapeHtml(label)}</span>`;
}

/* ---------------- Confirm dialog ---------------- */

let dialog = null;

function buildDialog() {
  dialog = document.createElement("dialog");
  dialog.className = "confirm";
  dialog.setAttribute("aria-labelledby", "confirm-title");
  dialog.setAttribute("aria-describedby", "confirm-message");
  dialog.innerHTML = `
    <form method="dialog" class="confirm__body">
      <h2 class="confirm__title" id="confirm-title"></h2>
      <p class="confirm__message" id="confirm-message"></p>
      <div class="confirm__actions">
        <button class="button button--quiet" value="cancel" data-cancel>Cancel</button>
        <button class="button" value="confirm" data-confirm></button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

/**
 * @param {{title: string, message?: string, confirmLabel?: string, danger?: boolean}} opts
 * @returns {Promise<boolean>} true if the person confirmed
 */
export function confirmDialog({ title, message = "", confirmLabel = "Confirm", danger = false }) {
  const box = dialog || buildDialog();
  box.querySelector(".confirm__title").textContent = title;
  const msg = box.querySelector(".confirm__message");
  msg.textContent = message;
  msg.hidden = !message;
  const confirm = box.querySelector("[data-confirm]");
  confirm.textContent = confirmLabel;
  confirm.classList.toggle("button--danger", danger);

  return new Promise((resolve) => {
    box.addEventListener("close", () => resolve(box.returnValue === "confirm"), { once: true });
    box.returnValue = "cancel";
    box.showModal();
    // Safer default for destructive actions: focus Cancel, not Delete.
    box.querySelector(danger ? "[data-cancel]" : "[data-confirm]").focus();
  });
}

/* ---------------- Toasts ---------------- */

let region = null;

/** @param {string} message  @param {"ok"|"error"} [kind] */
export function toast(message, kind = "ok") {
  if (!region) {
    region = document.createElement("div");
    region.className = "toasts";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  const item = document.createElement("p");
  item.className = `toast toast--${kind}`;
  item.textContent = message;
  region.appendChild(item);
  setTimeout(() => item.classList.add("is-leaving"), kind === "error" ? 6000 : 3500);
  setTimeout(() => item.remove(), kind === "error" ? 6400 : 3900);
}

/** Show a message on the next page load (e.g. "Post saved" after redirecting). */
export function flash(message, kind = "ok") {
  try {
    sessionStorage.setItem("orlu_admin_flash", JSON.stringify({ message, kind }));
  } catch {
    /* storage blocked */
  }
}

/** Call once on page load to show any flash message left by the previous page. */
export function showFlash() {
  try {
    const raw = sessionStorage.getItem("orlu_admin_flash");
    if (!raw) return;
    sessionStorage.removeItem("orlu_admin_flash");
    const { message, kind } = JSON.parse(raw);
    toast(message, kind);
  } catch {
    /* ignore */
  }
}

/* ---------------- Lagos time for date-time inputs ---------------- */
// <input type="datetime-local"> has no time zone. Admins type Nigerian time
// (WAT, UTC+1, no daylight saving), so convert explicitly rather than
// trusting the computer's own time zone.

const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** ISO timestamp -> "YYYY-MM-DDTHH:MM" in Lagos time, for a datetime-local input. */
export function toLagosInput(iso) {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + LAGOS_OFFSET_MS);
  return d.toISOString().slice(0, 16);
}

/** datetime-local value typed in Lagos time -> ISO timestamp in UTC. */
export function fromLagosInput(value) {
  if (!value) return null;
  const [date, time = "00:00"] = value.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - LAGOS_OFFSET_MS).toISOString();
}

/* ---------------- Slugs ---------------- */

/** "New Yam Festival 2026!" -> "new-yam-festival-2026" */
export function slugify(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents (ụ, ọ -> u, o)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
