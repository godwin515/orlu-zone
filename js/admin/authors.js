/**
 * Admin authors: list, add, edit and delete on one page.
 * Location: js/admin/authors.js   (loaded by admin/authors.html)
 *
 * GET    /admin/authors          list
 * POST   /admin/authors          add      { name, biography, profile_media_id }
 * PATCH  /admin/authors/{id}     edit
 * DELETE /admin/authors/{id}     delete (204)
 *
 * GAP workaround: AuthorResponse has profile_media_id but no image URL,
 * so photos are looked up in the media library (/admin/media).
 * Also loads /admin/posts to count each author's posts.
 */

import { admin, ApiError } from "../api.js";
import { escapeHtml, safeUrl, showLoading, showError } from "../ui.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import { confirmDialog, toast } from "./admin-ui.js";
import { pickMedia, loadLibrary } from "./media-picker.js";

const form = document.querySelector("[data-author-form]");
const f = (name) => form.elements.namedItem(name);

const els = {
  list: document.querySelector("[data-authors]"),
  panel: document.querySelector("[data-form-panel]"),
  formTitle: document.querySelector("[data-form-title]"),
  formError: document.querySelector("[data-form-error]"),
  save: document.querySelector("[data-save]"),
  cancel: document.querySelector("[data-cancel-edit]"),
  photo: document.querySelector("[data-photo]"),
};

const state = {
  authors: [],
  media: new Map(), // media id -> media record (for photo URLs)
  postCounts: new Map(),
  editingId: null,
  photo: null, // { id, public_url } chosen in the form
  saving: false,
};

/* ---------------- Helpers ---------------- */

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function avatar(author, size = "md") {
  const m = author.profile_media_id ? state.media.get(author.profile_media_id) : null;
  return m
    ? `<img class="avatar avatar--${size}" src="${safeUrl(m.public_url)}" alt="">`
    : `<span class="avatar avatar--${size} avatar--initials" aria-hidden="true">${escapeHtml(initials(author.name))}</span>`;
}

function setFieldError(name, message) {
  const input = f(name);
  const error = form.querySelector(`[data-error-for="${name}"]`);
  if (!input || !error) return false;
  const errId = `${name}-error`;
  if (message) {
    error.id = errId;
    error.textContent = message;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", errId);
  } else {
    error.hidden = true;
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }
  return true;
}

function clearErrors() {
  form.querySelectorAll("[data-error-for]").forEach((e) => setFieldError(e.dataset.errorFor, ""));
  els.formError.hidden = true;
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
      <span class="avatar avatar--lg avatar--initials" aria-hidden="true">${escapeHtml(initials(f("name").value || "?"))}</span>
      <div class="avatar-choice__actions">
        <button type="button" class="button button--quiet" data-choose-photo>Choose photo</button>
      </div>`;
}

els.photo.addEventListener("click", async (e) => {
  if (e.target.closest("[data-remove-photo]")) {
    state.photo = null;
    renderPhoto();
    return;
  }
  if (e.target.closest("[data-choose-photo]")) {
    const chosen = await pickMedia({ selected: state.photo ? [state.photo.id] : [], title: "Choose a profile photo" });
    if (!chosen) return;
    const m = chosen[0];
    state.photo = m ? { id: m.id, public_url: m.public_url } : null;
    if (m) state.media.set(m.id, m);
    renderPhoto();
  }
});

/* ---------------- Form modes ---------------- */

function resetForm() {
  state.editingId = null;
  state.photo = null;
  form.reset();
  clearErrors();
  els.formTitle.textContent = "Add an author";
  els.save.textContent = "Add author";
  els.cancel.hidden = true;
  els.panel.classList.remove("is-editing");
  renderPhoto();
  renderList();
}

function startEdit(id) {
  const a = state.authors.find((x) => x.id === id);
  if (!a) return;
  state.editingId = id;
  clearErrors();
  f("name").value = a.name || "";
  f("biography").value = a.biography || "";
  const m = a.profile_media_id ? state.media.get(a.profile_media_id) : null;
  state.photo = m ? { id: m.id, public_url: m.public_url } : null;
  els.formTitle.textContent = `Edit “${a.name}”`;
  els.save.textContent = "Save changes";
  els.cancel.hidden = false;
  els.panel.classList.add("is-editing");
  renderPhoto();
  renderList();
  els.panel.scrollIntoView({ behavior: "smooth", block: "start" });
  f("name").focus({ preventScroll: true });
}

/* ---------------- List ---------------- */

function renderList() {
  if (!state.authors.length) {
    els.list.innerHTML = `
      <div class="empty-block">
        <p>No authors yet. Add at least one, for example “Community Editorial Team”, before writing posts.</p>
      </div>`;
    return;
  }

  els.list.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Author</th>
            <th scope="col">Posts</th>
            <th scope="col"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${state.authors
            .map((a) => {
              const count = state.postCounts.get(a.id) || 0;
              return `
              <tr ${a.id === state.editingId ? 'class="is-editing" aria-current="true"' : ""}>
                <td class="cell-title" data-label="Author">
                  <div class="person">
                    ${avatar(a)}
                    <div>
                      <span class="cell-title__text">${escapeHtml(a.name)}</span>
                      ${a.biography ? `<span class="cell-desc">${escapeHtml(a.biography)}</span>` : ""}
                    </div>
                  </div>
                </td>
                <td data-label="Posts">${count}</td>
                <td class="cell-actions">
                  <button class="link-button" type="button" data-edit="${escapeHtml(a.id)}">Edit</button>
                  <button class="link-button link-button--danger" type="button" data-delete="${escapeHtml(a.id)}">Delete</button>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
}

/* ---------------- Save ---------------- */

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.saving) return;
  clearErrors();

  const name = f("name").value.trim();
  if (!name) {
    setFieldError("name", "Enter the author's name.");
    f("name").focus();
    return;
  }
  if (state.authors.some((a) => a.id !== state.editingId && a.name.trim().toLowerCase() === name.toLowerCase())) {
    setFieldError("name", "There's already an author with this name.");
    f("name").focus();
    return;
  }

  const data = {
    name,
    biography: f("biography").value.trim() || null,
    profile_media_id: state.photo?.id || null,
  };

  state.saving = true;
  els.save.disabled = true;
  els.save.textContent = "Saving…";

  try {
    if (state.editingId) {
      const saved = await admin.authors.update(state.editingId, data);
      state.authors = state.authors.map((a) => (a.id === saved.id ? saved : a));
      toast(`“${saved.name}” updated`);
    } else {
      const saved = await admin.authors.create(data);
      state.authors = [...state.authors, saved];
      toast(`“${saved.name}” added`);
    }
    state.authors.sort((a, b) => a.name.localeCompare(b.name));
    resetForm();
    f("name").focus();
  } catch (error) {
    els.save.textContent = state.editingId ? "Save changes" : "Add author";
    let matched = false;
    if (error instanceof ApiError && error.status === 422) {
      for (const [field, message] of Object.entries(error.fieldErrors)) {
        if (setFieldError(field, message)) matched = true;
      }
    }
    if (!matched) {
      els.formError.textContent = error.message || "Couldn't save the author.";
      els.formError.hidden = false;
    }
  } finally {
    state.saving = false;
    els.save.disabled = false;
  }
});

/* ---------------- Delete ---------------- */

async function deleteAuthor(id, button) {
  const a = state.authors.find((x) => x.id === id);
  if (!a) return;
  const count = state.postCounts.get(id) || 0;

  const ok = await confirmDialog({
    title: `Delete “${a.name}”?`,
    message: count
      ? `${count} ${count === 1 ? "post is" : "posts are"} written by this author. Change ${count === 1 ? "its" : "their"} author first, or the server may refuse the delete.`
      : "No posts use this author. This can't be undone.",
    confirmLabel: "Delete author",
    danger: true,
  });
  if (!ok) return;

  button.disabled = true;
  try {
    await admin.authors.remove(id);
    state.authors = state.authors.filter((x) => x.id !== id);
    if (state.editingId === id) resetForm();
    else renderList();
    toast(`“${a.name}” deleted`);
  } catch (error) {
    button.disabled = false;
    toast(
      error instanceof ApiError && [400, 409].includes(error.status)
        ? `Couldn't delete “${a.name}”: they still have posts.`
        : error.message || "Couldn't delete the author.",
      "error",
    );
  }
}

/* ---------------- Events ---------------- */

f("name").addEventListener("input", () => {
  if (!state.photo) renderPhoto(); // keep the initials preview current
  if (f("name").getAttribute("aria-invalid") === "true") setFieldError("name", "");
});
els.cancel.addEventListener("click", resetForm);
form.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.editingId) resetForm();
});

els.list.addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-delete]");
  if (edit) startEdit(edit.dataset.edit);
  if (del) deleteAuthor(del.dataset.delete, del);
});

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.list, { lines: 4 });
  try {
    const [authors, posts, media] = await Promise.all([
      admin.authors.list(),
      admin.posts.list().catch(() => []),
      loadLibrary().catch(() => []),
    ]);
    stop();
    state.authors = [...authors].sort((a, b) => a.name.localeCompare(b.name));
    state.media = new Map(media.map((m) => [m.id, m]));
    state.postCounts = posts.reduce((map, p) => map.set(p.author_id, (map.get(p.author_id) || 0) + 1), new Map());
    renderList();
  } catch (error) {
    stop();
    showError(els.list, error, load);
  }
}

const user = await requireAdmin();
renderAdminLayout(user);
setAdminTitle("Authors");
renderPhoto();
load();
