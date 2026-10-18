/**
 * Create and edit an event.
 * Location: js/admin/event-edit.js   (loaded by admin/event-edit.html)
 *
 * New event:  POST  /admin/events            then PUT /admin/events/{id}/media for photos
 * Edit event: GET   /admin/events/{id}       + GET /admin/events/{id}/media
 *             PATCH /admin/events/{id}       then PUT .../media if the photos changed
 * Delete:     DELETE /admin/events/{id}
 *
 * Times are typed in Nigerian time and sent to the API in UTC.
 */

import { SITE_BASE } from "../config.js";
import { admin, ApiError } from "../api.js";
import { escapeHtml, safeUrl, urls, eventWhen, showLoading, showError } from "../ui.js";
import { renderContent, enhanceContent } from "../content.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import {
  confirmDialog,
  toast,
  flash,
  showFlash,
  toLagosInput,
  fromLagosInput,
  slugify,
  SLUG_PATTERN,
} from "./admin-ui.js";
import { pickMedia, findMedia } from "./media-picker.js";

const eventId = new URLSearchParams(window.location.search).get("id");
const isNew = !eventId;

const form = document.querySelector("[data-event-form]");
const f = (name) => form.elements.namedItem(name);

const els = {
  title: document.querySelector("[data-page-title]"),
  headActions: document.querySelector("[data-head-actions]"),
  loadState: document.querySelector("[data-load-state]"),
  formError: document.querySelector("[data-form-error]"),
  save: document.querySelector("[data-save]"),
  saveState: document.querySelector("[data-save-state]"),
  cancelNote: document.querySelector("[data-cancel-note]"),
  whenSummary: document.querySelector("[data-when-summary]"),
  preview: document.querySelector("[data-preview]"),
  writePanel: document.querySelector("#description-write"),
  gallery: document.querySelector("[data-gallery]"),
  featuredImage: document.querySelector("[data-featured-image]"),
};

const state = {
  event: null, // as last saved
  featured: null,
  gallery: [],
  galleryChanged: false,
  slugTouched: !isNew,
  dirty: false,
  saving: false,
};

/* ---------------- Helpers ---------------- */

const status = () => form.querySelector('input[name="status"]:checked')?.value || "draft";

function setStatus(value) {
  const radio = form.querySelector(`input[name="status"][value="${value}"]`);
  if (radio) radio.checked = true;
  syncStatusUi();
}

function markDirty() {
  state.dirty = true;
  els.saveState.textContent = "Unsaved changes";
}

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

function focusFirstError() {
  const first = form.querySelector('[aria-invalid="true"]');
  if (!first) return;
  if (first.id === "description" && els.writePanel.hidden) showView("write");
  first.focus();
  first.scrollIntoView({ block: "center", behavior: "smooth" });
}

/* ---------------- Status and save button ---------------- */

function saveLabel() {
  const s = status();
  const was = state.event?.status;
  if (s === "published") return !isNew && was === "published" ? "Update" : "Publish";
  if (s === "cancelled") return !isNew && was === "cancelled" ? "Update" : "Mark as cancelled";
  return "Save draft";
}

function syncStatusUi() {
  els.cancelNote.hidden = status() !== "cancelled";
  if (!state.saving) els.save.textContent = saveLabel();
}

/* ---------------- When: readable summary ---------------- */

function updateWhenSummary() {
  const start = fromLagosInput(f("start_at").value);
  const end = fromLagosInput(f("end_at").value);
  els.whenSummary.textContent = start ? `Shown on the website as: ${eventWhen({ start_at: start, end_at: end })}` : "";
}

/* ---------------- Featured image ---------------- */

function renderFeatured() {
  const m = state.featured;
  els.featuredImage.innerHTML = m
    ? `
      <figure class="image-choice">
        <img src="${safeUrl(m.public_url)}" alt="${escapeHtml(m.alt_text || "")}">
        <div class="image-choice__actions">
          <button type="button" class="link-button" data-change-featured>Change</button>
          <button type="button" class="link-button link-button--danger" data-remove-featured>Remove</button>
        </div>
      </figure>`
    : `
      <p class="field__hint">Shown at the top of the event page and in event lists.</p>
      <button type="button" class="button button--quiet" data-change-featured>Choose image</button>`;
}

els.featuredImage.addEventListener("click", async (e) => {
  if (e.target.closest("[data-remove-featured]")) {
    state.featured = null;
    renderFeatured();
    markDirty();
    els.featuredImage.querySelector("[data-change-featured]")?.focus();
    return;
  }
  if (e.target.closest("[data-change-featured]")) {
    const chosen = await pickMedia({ selected: state.featured ? [state.featured.id] : [], title: "Choose the featured image" });
    if (!chosen) return;
    const m = chosen[0];
    state.featured = m ? { id: m.id, public_url: m.public_url, alt_text: m.alt_text } : null;
    renderFeatured();
    markDirty();
  }
});

/* ---------------- Photos ---------------- */

function renderGallery() {
  if (!state.gallery.length) {
    els.gallery.innerHTML = `<p class="panel__empty">No photos added.</p>`;
    return;
  }
  const last = state.gallery.length - 1;
  els.gallery.innerHTML = `
    <ol class="thumb-list">
      ${state.gallery
        .map(
          (g, i) => `
        <li class="thumb-list__item">
          <img src="${safeUrl(g.public_url)}" alt="${escapeHtml(g.alt_text || "")}">
          <div class="thumb-list__actions">
            <button type="button" class="icon-button" data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""}
              aria-label="Move photo ${i + 1} earlier">&larr;</button>
            <button type="button" class="icon-button" data-move="${i}" data-dir="1" ${i === last ? "disabled" : ""}
              aria-label="Move photo ${i + 1} later">&rarr;</button>
            <button type="button" class="icon-button icon-button--danger" data-remove="${i}"
              aria-label="Remove photo ${i + 1}">&times;</button>
          </div>
        </li>`,
        )
        .join("")}
    </ol>`;
}

els.gallery.addEventListener("click", (e) => {
  const move = e.target.closest("[data-move]");
  const remove = e.target.closest("[data-remove]");
  if (move) {
    const i = Number(move.dataset.move);
    const j = i + Number(move.dataset.dir);
    [state.gallery[i], state.gallery[j]] = [state.gallery[j], state.gallery[i]];
  } else if (remove) {
    state.gallery.splice(Number(remove.dataset.remove), 1);
  } else {
    return;
  }
  state.galleryChanged = true;
  markDirty();
  renderGallery();
});

document.querySelector("[data-pick-gallery]").addEventListener("click", async () => {
  const chosen = await pickMedia({
    multiple: true,
    selected: state.gallery.map((g) => g.media_id),
    title: "Choose photos for this event",
  });
  if (!chosen) return;
  state.gallery = chosen.map((m) => ({ media_id: m.id, public_url: m.public_url, alt_text: m.alt_text }));
  state.galleryChanged = true;
  markDirty();
  renderGallery();
});

/* ---------------- Write / Preview ---------------- */

function showView(view) {
  const preview = view === "preview";
  form.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
  els.writePanel.hidden = preview;
  els.preview.hidden = !preview;
  if (preview) {
    const text = f("description").value;
    els.preview.innerHTML = text.trim() ? renderContent(text) : `<p class="panel__empty">Nothing to preview yet.</p>`;
    enhanceContent(els.preview);
  }
}

form.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

/* ---------------- Field behaviour ---------------- */

f("title").addEventListener("input", () => {
  if (!state.slugTouched) {
    f("slug").value = slugify(f("title").value);
    if (f("slug").value) setFieldError("slug", "");
  }
});
f("slug").addEventListener("input", () => (state.slugTouched = true));
f("slug").addEventListener("blur", () => {
  const cleaned = slugify(f("slug").value);
  if (cleaned !== f("slug").value) f("slug").value = cleaned;
});

// Picking a start date fills an empty end with the same day, 3 hours later.
f("start_at").addEventListener("change", () => {
  const start = f("start_at").value;
  if (start && !f("end_at").value) {
    const end = new Date(new Date(fromLagosInput(start)).getTime() + 3 * 3600 * 1000).toISOString();
    f("end_at").value = toLagosInput(end);
  }
  f("end_at").min = start || "";
  updateWhenSummary();
});
f("end_at").addEventListener("change", updateWhenSummary);

form.addEventListener("change", (e) => {
  if (e.target.name === "status") syncStatusUi();
});
form.addEventListener("input", markDirty);
form.addEventListener("change", markDirty);

const clearOwnError = (e) => {
  if (e.target.name && e.target.getAttribute("aria-invalid") === "true") setFieldError(e.target.name, "");
};
form.addEventListener("input", clearOwnError);
form.addEventListener("change", clearOwnError);

window.addEventListener("beforeunload", (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ---------------- Validation ---------------- */

function validate() {
  clearErrors();
  let ok = true;
  const fail = (name, message) => {
    setFieldError(name, message);
    ok = false;
  };

  if (!f("title").value.trim()) fail("title", "Give the event a name.");

  const slug = f("slug").value.trim();
  if (!slug) fail("slug", "Add a web address, for example community-town-hall.");
  else if (!SLUG_PATTERN.test(slug)) fail("slug", "Use only lowercase letters, numbers and single hyphens.");

  const start = f("start_at").value;
  const end = f("end_at").value;
  if (!start) fail("start_at", "Choose when the event starts.");
  if (start && end && new Date(fromLagosInput(end)) <= new Date(fromLagosInput(start))) {
    fail("end_at", "The end must be after the start.");
  }

  if (!f("description").value.trim()) fail("description", "Describe the event before saving.");
  return ok;
}

/* ---------------- Save ---------------- */

function payload() {
  return {
    title: f("title").value.trim(),
    slug: f("slug").value.trim(),
    description: f("description").value,
    start_at: fromLagosInput(f("start_at").value),
    end_at: fromLagosInput(f("end_at").value),
    location: f("location").value.trim() || null,
    status: status(),
    featured_media_id: state.featured?.id || null,
  };
}

function savedMessage(newStatus, oldStatus) {
  if (newStatus === "draft") return "Draft saved";
  if (newStatus === "cancelled") return oldStatus === "cancelled" ? "Event updated" : "Event marked as cancelled";
  return oldStatus === "published" ? "Event updated" : "Event published";
}

function applyServerErrors(error) {
  let matched = false;
  if (error instanceof ApiError && error.status === 422) {
    for (const [field, message] of Object.entries(error.fieldErrors)) {
      if (setFieldError(field, message)) matched = true;
    }
  }
  if (!matched && error instanceof ApiError && [400, 409].includes(error.status) && /slug/i.test(error.message)) {
    setFieldError("slug", "Another event already uses this web address. Change it slightly.");
    matched = true;
  }
  if (matched) {
    focusFirstError();
  } else {
    els.formError.textContent = error.message || "Couldn't save the event. Please try again.";
    els.formError.hidden = false;
    els.formError.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.saving) return;
  if (!validate()) {
    focusFirstError();
    return;
  }

  const data = payload();
  const oldStatus = state.event?.status;
  state.saving = true;
  els.save.disabled = true;
  els.save.textContent = "Saving…";
  els.saveState.textContent = "";

  try {
    const saved = isNew ? await admin.events.create(data) : await admin.events.update(eventId, data);

    if (state.galleryChanged) {
      try {
        await admin.events.setMedia(saved.id, state.gallery.map((g) => g.media_id));
        state.galleryChanged = false;
      } catch (error) {
        toast(`Event saved, but the photos didn't: ${error.message}`, "error");
      }
    }

    const message = savedMessage(data.status, oldStatus);
    state.dirty = false;

    if (isNew) {
      flash(message);
      window.location.replace(`${SITE_BASE}admin/event-edit.html?id=${encodeURIComponent(saved.id)}`);
      return;
    }

    state.event = saved;
    fillHeader();
    toast(message);
    els.saveState.textContent = `Saved ${new Date().toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}`;
  } catch (error) {
    applyServerErrors(error);
    els.saveState.textContent = "Not saved";
  } finally {
    state.saving = false;
    els.save.disabled = false;
    syncStatusUi();
  }
});

/* ---------------- Delete ---------------- */

async function deleteEvent() {
  const ok = await confirmDialog({
    title: "Delete this event?",
    message: `“${state.event?.title || "Untitled event"}” will be removed from the website and can't be recovered. To keep it visible as called off, set it to Cancelled instead.`,
    confirmLabel: "Delete event",
    danger: true,
  });
  if (!ok) return;
  try {
    await admin.events.remove(eventId);
    state.dirty = false;
    flash("Event deleted");
    window.location.replace(`${SITE_BASE}admin/events.html`);
  } catch (error) {
    toast(error.message || "Couldn't delete the event.", "error");
  }
}

/* ---------------- Fill the page ---------------- */

function fillHeader() {
  els.title.textContent = isNew ? "New event" : "Edit event";
  setAdminTitle(isNew ? "New event" : state.event?.title || "Edit event");

  if (isNew || !state.event) {
    els.headActions.innerHTML = "";
    return;
  }
  const onSite = ["published", "cancelled"].includes(state.event.status);
  els.headActions.innerHTML = `
    ${onSite ? `<a class="button button--quiet" href="${escapeHtml(urls.event(state.event.slug))}" target="_blank" rel="noopener">View on website</a>` : ""}
    <button type="button" class="button button--quiet button--danger-quiet" data-delete-event>Delete event</button>`;
  els.headActions.querySelector("[data-delete-event]").addEventListener("click", deleteEvent);
}

function fillForm(event) {
  f("title").value = event.title || "";
  f("slug").value = event.slug || "";
  f("description").value = event.description || "";
  f("location").value = event.location || "";
  f("start_at").value = toLagosInput(event.start_at);
  f("end_at").value = toLagosInput(event.end_at);
  f("end_at").min = f("start_at").value;
  setStatus(event.status || "draft");
  updateWhenSummary();
}

async function load() {
  const stop = showLoading(els.loadState, { lines: 6 });
  try {
    const [event, media] = await Promise.all([
      isNew ? null : admin.events.get(eventId),
      isNew ? [] : admin.events.getMedia(eventId).catch(() => []),
    ]);
    stop();
    els.loadState.innerHTML = "";
    state.event = event;

    if (event) {
      fillForm(event);
      if (event.featured_media_id) {
        const m = event.featured_media_url
          ? { id: event.featured_media_id, public_url: event.featured_media_url }
          : await findMedia(event.featured_media_id);
        state.featured = m ? { id: m.id, public_url: m.public_url, alt_text: m.alt_text } : null;
      }
      state.gallery = [...media]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((g) => ({ media_id: g.media_id, public_url: g.public_url, alt_text: g.alt_text }));
    }

    fillHeader();
    renderFeatured();
    renderGallery();
    syncStatusUi();
    form.hidden = false;
    state.dirty = false;
    els.saveState.textContent = "";
    if (isNew) f("title").focus();
  } catch (error) {
    stop();
    if (error instanceof ApiError && error.status === 404) {
      els.loadState.innerHTML = `
        <div class="empty-block">
          <p>This event doesn't exist. It may have been deleted.</p>
          <a class="button" href="${SITE_BASE}admin/events.html">Back to events</a>
        </div>`;
      return;
    }
    showError(els.loadState, error, load);
  }
}

const user = await requireAdmin();
renderAdminLayout(user);
fillHeader();
showFlash();
load();
