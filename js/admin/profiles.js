/**
 * Admin Leadership: community profiles.
 * Location: js/admin/profiles.js   (loaded by admin/profiles.html)
 *
 * GET    /admin/community-profiles            every profile (published or not)
 * POST   /admin/community-profiles            add   { name, category, biography, profile_media_id, is_published, display_order }
 * PATCH  /admin/community-profiles/{id}       edit  (only the fields that changed)
 * DELETE /admin/community-profiles/{id}       delete (204)
 * PATCH  /admin/community-profiles/order      { profile_ids: [...] } — must list EVERY profile exactly once (204)
 *
 * Reordering happens on screen (drag or arrows) and is saved with "Save order".
 * New profiles are created at the end of the order, not at position 0.
 */

import { admin, ApiError } from "../api.js";
import { escapeHtml, safeUrl, showLoading, showError } from "../ui.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import { confirmDialog, toast } from "./admin-ui.js";
import { pickMedia } from "./media-picker.js";

const form = document.querySelector("[data-profile-form]");
const f = (name) => form.elements.namedItem(name);

const els = {
  bar: document.querySelector("[data-order-bar]"),
  saveOrder: document.querySelector("[data-save-order]"),
  undoOrder: document.querySelector("[data-undo-order]"),
  count: document.querySelector("[data-count]"),
  how: document.querySelector("[data-how]"),
  list: document.querySelector("[data-profiles]"),
  panel: document.querySelector("[data-form-panel]"),
  formTitle: document.querySelector("[data-form-title]"),
  formError: document.querySelector("[data-form-error]"),
  save: document.querySelector("[data-save]"),
  cancel: document.querySelector("[data-cancel-edit]"),
  photo: document.querySelector("[data-photo]"),
  categoryOptions: document.querySelector("[data-category-options]"),
  bioCount: document.querySelector("[data-bio-count]"),
};

const state = {
  profiles: [], // on-screen order
  savedOrder: [], // ids in the order last saved on the server
  editingId: null,
  photo: null, // { id, public_url }
  formDirty: false,
  busy: false,
};

const ids = () => state.profiles.map((p) => p.id);
const orderChanged = () => ids().join() !== state.savedOrder.join();

/* ---------------- Helpers ---------------- */

const TITLES = new Set([
  "mr", "mrs", "ms", "miss", "dr", "prof", "chief", "rev", "revd", "fr", "pastor", "sir", "hon", "engr", "barr",
  "arc", "elder", "deacon", "deaconess", "lolo", "ichie", "igwe", "nze", "ezinne", "hrh", "lady", "dame", "alhaji",
]);

function initials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  const real = words.filter((w) => !TITLES.has(w.toLowerCase().replace(/[.,]/g, "")));
  return (real.length ? real : words).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

function avatar(src, name, size = "md") {
  const url = safeUrl(src);
  return url
    ? `<img class="avatar avatar--${size}" src="${url}" alt="">`
    : `<span class="avatar avatar--${size} avatar--initials" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

function sortProfiles(list) {
  return [...list].sort(
    (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || new Date(a.created_at) - new Date(b.created_at),
  );
}

/** Existing category spellings (first spelling wins), for suggestions and matching. */
function categories() {
  const seen = new Map();
  for (const p of state.profiles) {
    const c = (p.category || "").trim();
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()];
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

/* ---------------- List ---------------- */

function renderList({ focus } = {}) {
  const n = state.profiles.length;
  const live = state.profiles.filter((p) => p.is_published).length;
  els.count.textContent = n ? `${n} ${n === 1 ? "profile" : "profiles"}, ${live} on the website` : "";
  els.how.hidden = n < 2;
  els.bar.hidden = !orderChanged();
  els.categoryOptions.innerHTML = categories().map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");

  if (!n) {
    els.list.innerHTML = `
      <div class="empty-block">
        <p>No profiles yet. Add the first one with the form, then tick “Show on the website” when it's ready.</p>
      </div>`;
    return;
  }

  const last = n - 1;
  els.list.innerHTML = `
    <ol class="profile-rows" data-rows>
      ${state.profiles
        .map(
          (p, i) => `
        <li class="profile-row${p.id === state.editingId ? " is-editing" : ""}${p.is_published ? "" : " is-hidden"}"
          draggable="true" data-id="${escapeHtml(p.id)}">
          <span class="profile-row__pos" aria-hidden="true">${i + 1}</span>
          ${avatar(p.profile_media_url, p.name)}
          <div class="profile-row__text">
            <span class="profile-row__name">${escapeHtml(p.name)}</span>
            <span class="profile-row__cat">${escapeHtml(p.category || "")}</span>
          </div>
          <span class="tag ${p.is_published ? "tag--published" : "tag--draft"}">${p.is_published ? "Published" : "Hidden"}</span>
          <div class="profile-row__actions">
            <button type="button" class="icon-button" data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""}
              aria-label="Move ${escapeHtml(p.name)} up">&uarr;</button>
            <button type="button" class="icon-button" data-move="${i}" data-dir="1" ${i === last ? "disabled" : ""}
              aria-label="Move ${escapeHtml(p.name)} down">&darr;</button>
            <button type="button" class="link-button" data-toggle="${escapeHtml(p.id)}">${p.is_published ? "Hide" : "Publish"}</button>
            <button type="button" class="link-button" data-edit="${escapeHtml(p.id)}">Edit</button>
            <button type="button" class="link-button link-button--danger" data-delete="${escapeHtml(p.id)}">Delete</button>
          </div>
        </li>`,
        )
        .join("")}
    </ol>`;

  if (focus) {
    const row = els.list.querySelector(`[data-id="${CSS.escape(focus.id)}"]`);
    (row?.querySelector(`[data-dir="${focus.dir}"]:not(:disabled)`) || row?.querySelector("[data-dir]:not(:disabled)"))?.focus();
  }
}

/* ---------------- Reorder ---------------- */

let dragId = null;

els.list.addEventListener("dragstart", (e) => {
  const row = e.target.closest(".profile-row");
  if (!row) return;
  dragId = row.dataset.id;
  row.classList.add("is-dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
});

els.list.addEventListener("dragover", (e) => {
  const over = e.target.closest(".profile-row");
  if (!dragId || !over || over.dataset.id === dragId) return;
  e.preventDefault();
  const from = state.profiles.findIndex((p) => p.id === dragId);
  const to = state.profiles.findIndex((p) => p.id === over.dataset.id);
  const [moved] = state.profiles.splice(from, 1);
  state.profiles.splice(to, 0, moved);
  renderList();
  els.list.querySelector(`[data-id="${CSS.escape(dragId)}"]`)?.classList.add("is-dragging");
});

els.list.addEventListener("drop", (e) => e.preventDefault());
els.list.addEventListener("dragend", () => {
  dragId = null;
  renderList();
});

els.saveOrder.addEventListener("click", async () => {
  if (state.busy) return;
  state.busy = true;
  els.saveOrder.disabled = true;
  els.saveOrder.textContent = "Saving…";
  try {
    await admin.profiles.reorder(ids()); // every id, exactly once
    state.savedOrder = ids();
    state.profiles.forEach((p, i) => (p.display_order = i));
    toast("Order saved");
    renderList();
  } catch (error) {
    // The contract says: show the error, then reload to match the server.
    toast(
      error instanceof ApiError && error.status === 422
        ? "The order couldn't be saved because the list was out of date. It's been refreshed; please arrange it again."
        : error.message || "Couldn't save the order.",
      "error",
    );
    await refresh();
  } finally {
    state.busy = false;
    els.saveOrder.disabled = false;
    els.saveOrder.textContent = "Save order";
  }
});

els.undoOrder.addEventListener("click", () => {
  const byId = new Map(state.profiles.map((p) => [p.id, p]));
  state.profiles = state.savedOrder.map((id) => byId.get(id)).filter(Boolean);
  renderList();
  toast("Order changes undone");
});

/* ---------------- Publish / hide straight from the list ---------------- */

async function togglePublished(id, button) {
  const p = state.profiles.find((x) => x.id === id);
  if (!p || state.busy) return;
  button.disabled = true;
  try {
    const saved = await admin.profiles.update(id, { is_published: !p.is_published });
    Object.assign(p, { is_published: saved.is_published ?? !p.is_published, updated_at: saved.updated_at });
    if (state.editingId === id) f("is_published").checked = p.is_published;
    renderList();
    toast(p.is_published ? `${p.name} is now on the website` : `${p.name} is hidden from the website`);
    els.list.querySelector(`[data-toggle="${CSS.escape(id)}"]`)?.focus();
  } catch (error) {
    button.disabled = false;
    toast(error.message || "Couldn't change that profile.", "error");
  }
}

/* ---------------- Photo in the form ---------------- */

function renderPhoto() {
  const p = state.photo;
  els.photo.innerHTML = p
    ? `
      <img class="avatar avatar--lg" src="${safeUrl(p.public_url)}" alt="">
      <div class="avatar-choice__actions">
        <button type="button" class="link-button" data-choose-photo>Change</button>
        <button type="button" class="link-button link-button--danger" data-remove-photo>Remove</button>
      </div>`
    : `
      <span class="avatar avatar--lg avatar--initials" aria-hidden="true">${escapeHtml(initials(f("name").value))}</span>
      <div class="avatar-choice__actions">
        <button type="button" class="button button--quiet" data-choose-photo>Choose photo</button>
      </div>`;
}

els.photo.addEventListener("click", async (e) => {
  if (e.target.closest("[data-remove-photo]")) {
    state.photo = null;
    state.formDirty = true;
    renderPhoto();
    return;
  }
  if (e.target.closest("[data-choose-photo]")) {
    const chosen = await pickMedia({ selected: state.photo ? [state.photo.id] : [], title: "Choose a profile photo" });
    if (!chosen) return;
    const m = chosen[0];
    state.photo = m ? { id: m.id, public_url: m.public_url } : null;
    state.formDirty = true;
    renderPhoto();
  }
});

/* ---------------- Form modes ---------------- */

function updateBioCount() {
  const n = f("biography").value.trim().length;
  els.bioCount.textContent = n ? `(${n} characters)` : "";
}

function resetForm() {
  state.editingId = null;
  state.photo = null;
  state.formDirty = false;
  form.reset();
  clearErrors();
  els.formTitle.textContent = "Add a profile";
  els.save.textContent = "Add profile";
  els.cancel.hidden = true;
  els.panel.classList.remove("is-editing");
  updateBioCount();
  renderPhoto();
  renderList();
}

async function startEdit(id) {
  if (state.formDirty && state.editingId !== id) {
    const discard = await confirmDialog({
      title: "Discard the changes in the form?",
      message: "You have unsaved changes in the profile form.",
      confirmLabel: "Discard changes",
      danger: true,
    });
    if (!discard) return;
  }
  const p = state.profiles.find((x) => x.id === id);
  if (!p) return;
  state.editingId = id;
  clearErrors();
  f("name").value = p.name || "";
  f("category").value = p.category || "";
  f("biography").value = p.biography || "";
  f("is_published").checked = Boolean(p.is_published);
  state.photo = p.profile_media_id ? { id: p.profile_media_id, public_url: p.profile_media_url } : null;
  state.formDirty = false;
  els.formTitle.textContent = `Edit “${p.name}”`;
  els.save.textContent = "Save changes";
  els.cancel.hidden = false;
  els.panel.classList.add("is-editing");
  updateBioCount();
  renderPhoto();
  renderList();
  els.panel.scrollIntoView({ behavior: "smooth", block: "start" });
  f("name").focus({ preventScroll: true });
}

/* ---------------- Save ---------------- */

/** Match the category to an existing spelling, ignoring capitals. */
function normaliseCategory(value) {
  const v = value.trim().replace(/\s+/g, " ");
  return categories().find((c) => c.toLowerCase() === v.toLowerCase()) || v;
}

function formValues() {
  return {
    name: f("name").value.trim(),
    category: normaliseCategory(f("category").value),
    biography: f("biography").value.trim() || null,
    profile_media_id: state.photo?.id || null,
    is_published: f("is_published").checked,
  };
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy) return;
  clearErrors();

  const data = formValues();
  if (!data.name) setFieldError("name", "Enter the person's name.");
  if (!data.category) setFieldError("category", "Choose or type a category, for example Community Leadership.");
  const first = form.querySelector('[aria-invalid="true"]');
  if (first) {
    first.focus();
    return;
  }

  state.busy = true;
  els.save.disabled = true;
  const label = els.save.textContent;
  els.save.textContent = "Saving…";

  try {
    if (state.editingId) {
      // Send only what changed, as the contract asks.
      const before = state.profiles.find((p) => p.id === state.editingId);
      const changes = {};
      for (const [k, v] of Object.entries(data)) {
        if ((before[k] ?? null) !== v) changes[k] = v;
      }
      if (!Object.keys(changes).length) {
        toast("Nothing to save: no changes.");
      } else {
        const saved = await admin.profiles.update(state.editingId, changes);
        Object.assign(before, saved);
        toast(`${saved.name || data.name} updated`);
      }
    } else {
      // New profiles go to the end instead of the API's default position 0.
      const lastOrder = Math.max(-1, ...state.profiles.map((p) => p.display_order ?? 0));
      const saved = await admin.profiles.create({ ...data, display_order: lastOrder + 1 });
      state.profiles.push(saved);
      state.savedOrder.push(saved.id);
      toast(`${saved.name} added${saved.is_published ? " and published" : " (hidden until you publish it)"}`);
    }
    els.save.textContent = label;
    resetForm();
    f("name").focus();
  } catch (error) {
    els.save.textContent = label;
    let matched = false;
    if (error instanceof ApiError && error.status === 422) {
      for (const [field, message] of Object.entries(error.fieldErrors)) if (setFieldError(field, message)) matched = true;
    }
    if (!matched) {
      els.formError.textContent =
        error instanceof ApiError && error.status === 404
          ? "This profile no longer exists. It may have been deleted. The list has been refreshed."
          : error.message || "Couldn't save the profile.";
      els.formError.hidden = false;
      if (error instanceof ApiError && error.status === 404) refresh();
    }
    form.querySelector('[aria-invalid="true"]')?.focus();
  } finally {
    state.busy = false;
    els.save.disabled = false;
  }
});

/* ---------------- Delete ---------------- */

async function deleteProfile(id, button) {
  const p = state.profiles.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmDialog({
    title: `Delete ${p.name}'s profile?`,
    message: `${p.is_published ? "It will disappear from the Leadership page. " : ""}This can't be undone. To take it off the website but keep it, use Hide instead.`,
    confirmLabel: "Delete profile",
    danger: true,
  });
  if (!ok) return;

  button.disabled = true;
  try {
    await admin.profiles.remove(id);
    state.profiles = state.profiles.filter((x) => x.id !== id);
    state.savedOrder = state.savedOrder.filter((x) => x !== id);
    if (state.editingId === id) resetForm();
    else renderList();
    toast("Profile deleted");
  } catch (error) {
    // Don't assume it worked: reload to match the server.
    toast(error.message || "Couldn't delete the profile.", "error");
    await refresh();
  }
}

/* ---------------- Events ---------------- */

els.list.addEventListener("click", (e) => {
  const move = e.target.closest("[data-move]");
  if (move) {
    const i = Number(move.dataset.move);
    const j = i + Number(move.dataset.dir);
    const id = state.profiles[i].id;
    [state.profiles[i], state.profiles[j]] = [state.profiles[j], state.profiles[i]];
    renderList({ focus: { id, dir: move.dataset.dir } });
    return;
  }
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) return togglePublished(toggle.dataset.toggle, toggle);
  const edit = e.target.closest("[data-edit]");
  if (edit) return startEdit(edit.dataset.edit);
  const del = e.target.closest("[data-delete]");
  if (del) deleteProfile(del.dataset.delete, del);
});

form.addEventListener("input", (e) => {
  state.formDirty = true;
  if (e.target.name === "name" && !state.photo) renderPhoto();
  if (e.target.name === "biography") updateBioCount();
  if (e.target.getAttribute("aria-invalid") === "true") setFieldError(e.target.name, "");
});

// Snap "community leadership" to the existing "Community Leadership".
f("category").addEventListener("blur", () => {
  const v = f("category").value;
  if (v.trim()) f("category").value = normaliseCategory(v);
});

els.cancel.addEventListener("click", resetForm);
form.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.editingId) resetForm();
});

window.addEventListener("beforeunload", (e) => {
  if (orderChanged() || state.formDirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ---------------- Load ---------------- */

function setFromServer(list) {
  state.profiles = sortProfiles(list);
  state.savedOrder = ids();
}

async function refresh() {
  try {
    setFromServer(await admin.profiles.list());
    if (state.editingId && !state.profiles.some((p) => p.id === state.editingId)) resetForm();
    else renderList();
  } catch {
    /* keep what's on screen */
  }
}

async function load() {
  const stop = showLoading(els.list, { lines: 5 });
  try {
    setFromServer(await admin.profiles.list());
    stop();
    renderList();
  } catch (error) {
    stop();
    showError(els.list, error, load);
  }
}

const user = await requireAdmin();
renderAdminLayout(user);
setAdminTitle("Leadership");
renderPhoto();
load();
