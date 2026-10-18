/**
 * Admin categories: list, add, edit and delete on one page.
 * Location: js/admin/categories.js   (loaded by admin/categories.html)
 *
 * GET    /admin/categories          list
 * POST   /admin/categories          add      { name, slug, description }
 * PATCH  /admin/categories/{id}     edit
 * DELETE /admin/categories/{id}     delete (204)
 *
 * Also loads /admin/posts to show how many posts use each category and
 * to warn before deleting one that's in use.
 */

import { SITE_BASE } from "../config.js";
import { admin, ApiError } from "../api.js";
import { escapeHtml, urls, showLoading, showError } from "../ui.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import { confirmDialog, toast, slugify, SLUG_PATTERN } from "./admin-ui.js";

const form = document.querySelector("[data-category-form]");
const f = (name) => form.elements.namedItem(name);

const els = {
  list: document.querySelector("[data-categories]"),
  panel: document.querySelector("[data-form-panel]"),
  formTitle: document.querySelector("[data-form-title]"),
  formError: document.querySelector("[data-form-error]"),
  save: document.querySelector("[data-save]"),
  cancel: document.querySelector("[data-cancel-edit]"),
  slugPreview: document.querySelector("[data-slug-preview]"),
};

const state = {
  categories: [],
  postCounts: new Map(), // category_id -> number of posts
  editingId: null,
  slugTouched: false,
  saving: false,
};

/* ---------------- Form helpers ---------------- */

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

function updateSlugPreview() {
  els.slugPreview.textContent = f("slug").value || "community-news";
}

function resetForm() {
  state.editingId = null;
  state.slugTouched = false;
  form.reset();
  clearErrors();
  els.formTitle.textContent = "Add a category";
  els.save.textContent = "Add category";
  els.cancel.hidden = true;
  els.panel.classList.remove("is-editing");
  updateSlugPreview();
  renderList();
}

function startEdit(id) {
  const c = state.categories.find((x) => x.id === id);
  if (!c) return;
  state.editingId = id;
  state.slugTouched = true;
  clearErrors();
  f("name").value = c.name || "";
  f("slug").value = c.slug || "";
  f("description").value = c.description || "";
  els.formTitle.textContent = `Edit “${c.name}”`;
  els.save.textContent = "Save changes";
  els.cancel.hidden = false;
  els.panel.classList.add("is-editing");
  updateSlugPreview();
  renderList();
  els.panel.scrollIntoView({ behavior: "smooth", block: "start" });
  f("name").focus({ preventScroll: true });
}

/* ---------------- List ---------------- */

function renderList() {
  if (!state.categories.length) {
    els.list.innerHTML = `
      <div class="empty-block">
        <p>No categories yet. Posts need a category, so add at least one, for example “Community News”.</p>
      </div>`;
    return;
  }

  els.list.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Posts</th>
            <th scope="col"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${state.categories
            .map((c) => {
              const count = state.postCounts.get(c.id) || 0;
              const editing = c.id === state.editingId;
              return `
              <tr ${editing ? 'class="is-editing" aria-current="true"' : ""}>
                <td class="cell-title" data-label="Name">
                  <span class="cell-title__text">${escapeHtml(c.name)}</span>
                  <span class="cell-sub">${escapeHtml(c.slug)}</span>
                  ${c.description ? `<span class="cell-desc">${escapeHtml(c.description)}</span>` : ""}
                </td>
                <td data-label="Posts">
                  ${count ? `<a href="${SITE_BASE}admin/posts.html?category=${encodeURIComponent(c.id)}">${count}</a>` : "0"}
                </td>
                <td class="cell-actions">
                  <button class="link-button" type="button" data-edit="${escapeHtml(c.id)}">Edit</button>
                  <a class="link-button" href="${escapeHtml(urls.category(c.slug))}" target="_blank" rel="noopener">View</a>
                  <button class="link-button link-button--danger" type="button" data-delete="${escapeHtml(c.id)}">Delete</button>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
}

/* ---------------- Save ---------------- */

function validate() {
  clearErrors();
  let ok = true;
  const name = f("name").value.trim();
  const slug = f("slug").value.trim();

  if (!name) {
    setFieldError("name", "Give the category a name.");
    ok = false;
  } else if (
    state.categories.some((c) => c.id !== state.editingId && c.name.trim().toLowerCase() === name.toLowerCase())
  ) {
    setFieldError("name", "There's already a category with this name.");
    ok = false;
  }

  if (!slug) {
    setFieldError("slug", "Add a web address, for example community-news.");
    ok = false;
  } else if (!SLUG_PATTERN.test(slug)) {
    setFieldError("slug", "Use only lowercase letters, numbers and single hyphens.");
    ok = false;
  } else if (state.categories.some((c) => c.id !== state.editingId && c.slug === slug)) {
    setFieldError("slug", "Another category already uses this web address.");
    ok = false;
  }
  return ok;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.saving) return;
  if (!validate()) {
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  const data = {
    name: f("name").value.trim(),
    slug: f("slug").value.trim(),
    description: f("description").value.trim() || null,
  };

  state.saving = true;
  els.save.disabled = true;
  const label = els.save.textContent;
  els.save.textContent = "Saving…";

  try {
    if (state.editingId) {
      const saved = await admin.categories.update(state.editingId, data);
      state.categories = state.categories.map((c) => (c.id === saved.id ? saved : c));
      toast(`“${saved.name}” updated`);
    } else {
      const saved = await admin.categories.create(data);
      state.categories = [...state.categories, saved];
      toast(`“${saved.name}” added`);
    }
    state.categories.sort((a, b) => a.name.localeCompare(b.name));
    els.save.textContent = label;
    resetForm();
    f("name").focus();
  } catch (error) {
    els.save.textContent = label;
    let matched = false;
    if (error instanceof ApiError && error.status === 422) {
      for (const [field, message] of Object.entries(error.fieldErrors)) {
        if (setFieldError(field, message)) matched = true;
      }
    }
    if (!matched && error instanceof ApiError && [400, 409].includes(error.status) && /slug|name|exist|unique/i.test(error.message)) {
      setFieldError("slug", "A category with this name or web address already exists.");
      matched = true;
    }
    if (!matched) {
      els.formError.textContent = error.message || "Couldn't save the category.";
      els.formError.hidden = false;
    }
    form.querySelector('[aria-invalid="true"]')?.focus();
  } finally {
    state.saving = false;
    els.save.disabled = false;
  }
});

/* ---------------- Delete ---------------- */

async function deleteCategory(id, button) {
  const c = state.categories.find((x) => x.id === id);
  if (!c) return;
  const count = state.postCounts.get(id) || 0;

  const ok = await confirmDialog({
    title: `Delete “${c.name}”?`,
    message: count
      ? `${count} ${count === 1 ? "post uses" : "posts use"} this category. Move ${count === 1 ? "it" : "them"} to another category first, or the server may refuse the delete.`
      : "No posts use this category. This can't be undone.",
    confirmLabel: "Delete category",
    danger: true,
  });
  if (!ok) return;

  button.disabled = true;
  try {
    await admin.categories.remove(id);
    state.categories = state.categories.filter((x) => x.id !== id);
    if (state.editingId === id) resetForm();
    else renderList();
    toast(`“${c.name}” deleted`);
  } catch (error) {
    button.disabled = false;
    toast(
      error instanceof ApiError && [400, 409].includes(error.status)
        ? `Couldn't delete “${c.name}”: it's still used by posts.`
        : error.message || "Couldn't delete the category.",
      "error",
    );
  }
}

/* ---------------- Events ---------------- */

f("name").addEventListener("input", () => {
  if (!state.slugTouched) {
    f("slug").value = slugify(f("name").value);
    updateSlugPreview();
  }
});
f("slug").addEventListener("input", () => {
  state.slugTouched = true;
  updateSlugPreview();
});
f("slug").addEventListener("blur", () => {
  f("slug").value = slugify(f("slug").value);
  updateSlugPreview();
});
form.addEventListener("input", (e) => {
  if (e.target.name && e.target.getAttribute("aria-invalid") === "true") setFieldError(e.target.name, "");
});

els.cancel.addEventListener("click", resetForm);
form.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.editingId) resetForm();
});

els.list.addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-delete]");
  if (edit) startEdit(edit.dataset.edit);
  if (del) deleteCategory(del.dataset.delete, del);
});

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.list, { lines: 4 });
  try {
    const [categories, posts] = await Promise.all([admin.categories.list(), admin.posts.list().catch(() => [])]);
    stop();
    state.categories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    state.postCounts = posts.reduce((map, p) => map.set(p.category_id, (map.get(p.category_id) || 0) + 1), new Map());
    renderList();
  } catch (error) {
    stop();
    showError(els.list, error, load);
  }
}

const user = await requireAdmin();
renderAdminLayout(user);
setAdminTitle("Categories");
load();
