/**
 * Site settings.
 * Location: js/admin/settings.js   (loaded by admin/settings.html)
 *
 * GET   /admin/site    load
 * PATCH /admin/site    save { community_name (required), description, logo_media_id,
 *                           email, phone, address, whatsapp_url }  (others nullable)
 *
 * Empty fields are sent as null so they disappear from the website.
 */

import { admin, adapters, ApiError } from "../api.js";
import { escapeHtml, safeUrl, showLoading, showError } from "../ui.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import { toast } from "./admin-ui.js";
import { pickMedia, findMedia } from "./media-picker.js";

const form = document.querySelector("[data-settings-form]");
const f = (name) => form.elements.namedItem(name);

const els = {
  loadState: document.querySelector("[data-load-state]"),
  formError: document.querySelector("[data-form-error]"),
  save: document.querySelector("[data-save]"),
  saveState: document.querySelector("[data-save-state]"),
  logo: document.querySelector("[data-logo]"),
  logoNote: document.querySelector("[data-logo-note]"),
  preview: document.querySelector("[data-preview]"),
  descCount: document.querySelector("[data-description-count]"),
};

const state = { site: null, logo: null, dirty: false, saving: false };

/* ---------------- Field helpers ---------------- */

function setFieldError(name, message) {
  const input = f(name);
  const error = form.querySelector(`[data-error-for="${name}"]`);
  if (!input || !error) return false;
  const errId = `${name}-error`;
  const described = (input.getAttribute("aria-describedby") || "").split(" ").filter((d) => d && d !== errId);
  if (message) {
    error.id = errId;
    error.textContent = message;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", [...described, errId].join(" "));
  } else {
    error.hidden = true;
    input.removeAttribute("aria-invalid");
    if (described.length) input.setAttribute("aria-describedby", described.join(" "));
    else input.removeAttribute("aria-describedby");
  }
  return true;
}

function clearErrors() {
  form.querySelectorAll("[data-error-for]").forEach((e) => setFieldError(e.dataset.errorFor, ""));
  els.formError.hidden = true;
}

/**
 * Turn what the admin typed into a WhatsApp link.
 *   "+234 803 000 0000" / "08030000000"  -> https://wa.me/2348030000000
 *   "https://wa.me/..." / "https://chat.whatsapp.com/..." -> unchanged
 * Returns { url } or { error }.
 */
function whatsappLink(raw) {
  const value = raw.trim();
  if (!value) return { url: null };
  if (/^https?:\/\//i.test(value)) {
    try {
      const host = new URL(value).hostname.replace(/^www\./, "");
      if (["wa.me", "chat.whatsapp.com", "api.whatsapp.com", "whatsapp.com"].includes(host)) {
        return { url: value.replace(/^http:/i, "https:") };
      }
    } catch {
      /* fall through */
    }
    return { error: "Use a WhatsApp link (wa.me or chat.whatsapp.com) or just type the number." };
  }
  let digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("0") && digits.length === 11) digits = `234${digits.slice(1)}`; // Nigerian local format
  digits = digits.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    return { error: "That doesn't look like a full phone number. Include the country code, e.g. +234." };
  }
  return { url: `https://wa.me/${digits}` };
}

/* ---------------- Logo ---------------- */

function renderLogo() {
  const m = state.logo;
  els.logo.innerHTML = m
    ? `
      <div class="logo-choice">
        <img src="${safeUrl(m.public_url)}" alt="${escapeHtml(m.alt_text || "Logo")}">
        <div class="image-choice__actions">
          <button type="button" class="link-button" data-change-logo>Change</button>
          <button type="button" class="link-button link-button--danger" data-remove-logo>Remove</button>
        </div>
      </div>`
    : `
      <p class="field__hint">A square image works best, for example 512 × 512 pixels.</p>
      <button type="button" class="button button--quiet" data-change-logo>Choose logo</button>`;
}

els.logo.addEventListener("click", async (e) => {
  if (e.target.closest("[data-remove-logo]")) {
    state.logo = null;
    renderLogo();
    markDirty();
    return;
  }
  if (e.target.closest("[data-change-logo]")) {
    const chosen = await pickMedia({ selected: state.logo ? [state.logo.id] : [], title: "Choose the logo" });
    if (!chosen) return;
    state.logo = chosen[0] || null;
    renderLogo();
    markDirty();
  }
});

/* ---------------- Live preview ---------------- */

function renderPreview() {
  const name = f("community_name").value.trim() || "Community name";
  const desc = f("description").value.trim();
  const phone = f("phone").value.trim();
  const email = f("email").value.trim();
  const address = f("address").value.trim();
  const wa = whatsappLink(f("whatsapp_url").value);
  // The website uses the logo file until the API sends logo_url.
  const logoSrc = adapters.logoUrl(state.site);

  const rows = [
    phone && `<li><span>Phone</span>${escapeHtml(phone)}</li>`,
    email && `<li><span>Email</span>${escapeHtml(email)}</li>`,
    wa.url && `<li><span>WhatsApp</span>Message us on WhatsApp</li>`,
    address && `<li><span>Address</span>${escapeHtml(address)}</li>`,
  ].filter(Boolean);

  els.preview.innerHTML = `
    <div class="settings-preview__header">
      <img src="${safeUrl(logoSrc)}" alt="" width="28" height="28">
      <strong>${escapeHtml(name)}</strong>
    </div>
    <div class="settings-preview__body">
      <p class="settings-preview__label">Footer and Contact page</p>
      ${desc ? `<p class="settings-preview__desc">${escapeHtml(desc)}</p>` : ""}
      ${rows.length ? `<ul class="settings-preview__list">${rows.join("")}</ul>` : `<p class="settings-preview__empty">No contact details yet.</p>`}
    </div>`;
}

function updateDescCount() {
  const n = f("description").value.length;
  els.descCount.textContent = n ? `(${n} of 300 characters)` : "";
}

/* ---------------- Dirty state ---------------- */

function markDirty() {
  state.dirty = true;
  els.saveState.textContent = "Unsaved changes";
  renderPreview();
}

form.addEventListener("input", (e) => {
  markDirty();
  if (e.target.name === "description") updateDescCount();
  if (e.target.getAttribute("aria-invalid") === "true") setFieldError(e.target.name, "");
});

// Show the converted WhatsApp link when leaving the field.
f("whatsapp_url").addEventListener("blur", () => {
  const { url, error } = whatsappLink(f("whatsapp_url").value);
  if (error) setFieldError("whatsapp_url", error);
  else if (url && url !== f("whatsapp_url").value) {
    f("whatsapp_url").value = url;
    renderPreview();
  }
});

window.addEventListener("beforeunload", (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ---------------- Save ---------------- */

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.saving) return;
  clearErrors();

  const name = f("community_name").value.trim();
  const email = f("email").value.trim();
  const wa = whatsappLink(f("whatsapp_url").value);

  if (!name) setFieldError("community_name", "The community needs a name.");
  if (email && !f("email").checkValidity()) setFieldError("email", "Enter a valid email, like name@example.org.");
  if (wa.error) setFieldError("whatsapp_url", wa.error);

  const firstError = form.querySelector('[aria-invalid="true"]');
  if (firstError) {
    firstError.focus();
    return;
  }

  const data = {
    community_name: name,
    description: f("description").value.trim() || null,
    logo_media_id: state.logo?.id || null,
    email: email || null,
    phone: f("phone").value.trim() || null,
    address: f("address").value.trim() || null,
    whatsapp_url: wa.url,
  };

  state.saving = true;
  els.save.disabled = true;
  els.save.textContent = "Saving…";
  try {
    state.site = await admin.site.update(data);
    if (wa.url) f("whatsapp_url").value = wa.url;
    state.dirty = false;
    toast("Settings saved. The website shows them straight away.");
    els.saveState.textContent = `Saved ${new Date().toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}`;
    // Update the community name in the admin sidebar too.
    const brand = document.querySelector("[data-admin-name]");
    if (brand) brand.textContent = state.site.community_name || name;
  } catch (error) {
    let matched = false;
    if (error instanceof ApiError && error.status === 422) {
      for (const [field, message] of Object.entries(error.fieldErrors)) if (setFieldError(field, message)) matched = true;
    }
    if (!matched) {
      els.formError.textContent = error.message || "Couldn't save the settings.";
      els.formError.hidden = false;
    }
    form.querySelector('[aria-invalid="true"]')?.focus();
    els.saveState.textContent = "Not saved";
  } finally {
    state.saving = false;
    els.save.disabled = false;
    els.save.textContent = "Save settings";
  }
});

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.loadState, { lines: 5 });
  try {
    const site = await admin.site.get();
    stop();
    els.loadState.innerHTML = "";
    state.site = site;

    f("community_name").value = site.community_name || "";
    f("description").value = site.description || "";
    f("phone").value = site.phone || "";
    f("email").value = site.email || "";
    f("whatsapp_url").value = site.whatsapp_url || "";
    f("address").value = site.address || "";
    updateDescCount();

    if (site.logo_media_id) state.logo = await findMedia(site.logo_media_id);
    // If the backend starts returning logo_url, the website uses it: drop the warning.
    els.logoNote.hidden = Boolean(site.logo_url);

    renderLogo();
    renderPreview();
    form.hidden = false;
    state.dirty = false;
    els.saveState.textContent = site.updated_at
      ? `Last saved ${new Date(site.updated_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}`
      : "";
  } catch (error) {
    stop();
    showError(els.loadState, error, load);
  }
}

const user = await requireAdmin();
renderAdminLayout(user);
setAdminTitle("Site settings");
load();
