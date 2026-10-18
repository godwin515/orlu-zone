/**
 * Create and edit a post.
 * Location: js/admin/post-edit.js   (loaded by admin/post-edit.html)
 *
 * New post:  POST  /admin/posts             then PUT /admin/posts/{id}/media for photos
 * Edit post: GET   /admin/posts/{id}        + GET /admin/posts/{id}/media
 *            PATCH /admin/posts/{id}        then PUT .../media if the photos changed
 * Delete:    DELETE /admin/posts/{id}
 *
 * Categories, authors and events fill the dropdowns. Images come from the
 * media picker (choose from the library or upload).
 */

import { SITE_BASE } from "../config.js";
import { admin, ApiError } from "../api.js";
import { escapeHtml, safeUrl, urls, showLoading, showError } from "../ui.js";
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

const postId = new URLSearchParams(window.location.search).get("id");
const isNew = !postId;

const form = document.querySelector("[data-post-form]");
const f = (name) => form.elements.namedItem(name);

const els = {
  title: document.querySelector("[data-page-title]"),
  headActions: document.querySelector("[data-head-actions]"),
  loadState: document.querySelector("[data-load-state]"),
  formError: document.querySelector("[data-form-error]"),
  save: document.querySelector("[data-save]"),
  saveState: document.querySelector("[data-save-state]"),
  scheduleField: document.querySelector("[data-schedule-field]"),
  excerptCount: document.querySelector("[data-excerpt-count]"),
  preview: document.querySelector("[data-preview]"),
  writePanel: document.querySelector("#content-write"),
  gallery: document.querySelector("[data-gallery]"),
  featuredImage: document.querySelector("[data-featured-image]"),
};

const state = {
  post: null, // as last saved
  featured: null, // { id, public_url, alt_text } or null
  gallery: [], // [{ media_id, public_url, alt_text }]
  galleryChanged: false,
  slugTouched: !isNew,
  dirty: false,
  saving: false,
};

/* ---------------- Small helpers ---------------- */

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
  if (message) {
    error.id = `${name}-error`;
    error.textContent = message;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    const described = (input.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
    if (!described.includes(error.id)) input.setAttribute("aria-describedby", [...described, error.id].join(" "));
  } else {
    error.hidden = true;
    input.removeAttribute("aria-invalid");
    const described = (input.getAttribute("aria-describedby") || "").split(" ").filter((d) => d !== `${name}-error`);
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
  if (first) {
    if (first.id === "content" && els.writePanel.hidden) showView("write");
    first.focus();
    first.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

/* ---------------- Status and save button ---------------- */

function saveLabel() {
  const s = status();
  if (s === "scheduled") return "Schedule";
  if (s === "published") return !isNew && state.post?.status === "published" ? "Update" : "Publish";
  return "Save draft";
}

function syncStatusUi() {
  const s = status();
  els.scheduleField.hidden = s !== "scheduled";
  if (!state.saving) els.save.textContent = saveLabel();
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
      <p class="field__hint">Shown at the top of the post and on news cards.</p>
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

/* ---------------- Photos (post gallery) ---------------- */

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
    title: "Choose photos for this post",
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
    const content = f("content").value;
    els.preview.innerHTML = content.trim()
      ? renderContent(content)
      : `<p class="panel__empty">Nothing to preview yet.</p>`;
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

f("slug").addEventListener("input", () => {
  state.slugTouched = true;
});
f("slug").addEventListener("blur", () => {
  const cleaned = slugify(f("slug").value);
  if (cleaned !== f("slug").value) f("slug").value = cleaned;
});

function updateExcerptCount() {
  const n = f("excerpt").value.length;
  els.excerptCount.textContent = n ? `(${n} characters)` : "";
}
f("excerpt").addEventListener("input", updateExcerptCount);

form.addEventListener("change", (e) => {
  if (e.target.name === "status") syncStatusUi();
});
form.addEventListener("input", markDirty);

// Clear a field's error as soon as the person starts fixing it.
const clearOwnError = (e) => {
  const name = e.target.name;
  if (name && e.target.getAttribute("aria-invalid") === "true") setFieldError(name, "");
};
form.addEventListener("input", clearOwnError);
form.addEventListener("change", clearOwnError);
form.addEventListener("change", markDirty);

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

  if (!f("title").value.trim()) fail("title", "Give the post a title.");

  const slug = f("slug").value.trim();
  if (!slug) fail("slug", "Add a web address, for example road-project-update.");
  else if (!SLUG_PATTERN.test(slug)) fail("slug", "Use only lowercase letters, numbers and single hyphens.");

  if (!f("content").value.trim()) fail("content", "Write the post text before saving.");
  if (!f("category_id").value) fail("category_id", "Choose a category.");
  if (!f("author_id").value) fail("author_id", "Choose an author.");

  const video = f("video_url").value.trim();
  if (video && !/^https?:\/\/\S+\.\S+/i.test(video)) fail("video_url", "Paste the full link, starting with https://");

  if (status() === "scheduled") {
    const when = f("scheduled_at").value;
    if (!when) fail("scheduled_at", "Choose when to publish.");
    else if (new Date(fromLagosInput(when)) <= new Date()) fail("scheduled_at", "Choose a time in the future, or publish now instead.");
  }
  return ok;
}

/* ---------------- Save ---------------- */

function payload() {
  const s = status();
  const nowIso = new Date().toISOString();
  return {
    title: f("title").value.trim(),
    slug: f("slug").value.trim(),
    excerpt: f("excerpt").value.trim() || null,
    content: f("content").value,
    status: s,
    featured: f("featured").checked,
    category_id: f("category_id").value,
    author_id: f("author_id").value,
    event_id: f("event_id").value || null,
    video_url: f("video_url").value.trim() || null,
    featured_media_id: state.featured?.id || null,
    scheduled_at: s === "scheduled" ? fromLagosInput(f("scheduled_at").value) : null,
    // Keep the original publish date when updating a live post.
    published_at: s === "published" ? state.post?.published_at || nowIso : null,
  };
}

const SAVED_MESSAGES = {
  draft: "Draft saved",
  scheduled: "Post scheduled",
  published: (wasLive) => (wasLive ? "Post updated" : "Post published"),
};

function applyServerErrors(error) {
  let matched = false;
  if (error instanceof ApiError && error.status === 422) {
    for (const [field, message] of Object.entries(error.fieldErrors)) {
      if (setFieldError(field, message)) matched = true;
    }
  }
  // Duplicate web address: backends often answer 400/409 with a message naming the slug.
  if (!matched && error instanceof ApiError && [400, 409].includes(error.status) && /slug/i.test(error.message)) {
    setFieldError("slug", "Another post already uses this web address. Change it slightly.");
    matched = true;
  }
  if (!matched) {
    els.formError.textContent = error.message || "Couldn't save the post. Please try again.";
    els.formError.hidden = false;
    els.formError.scrollIntoView({ block: "center", behavior: "smooth" });
  } else {
    focusFirstError();
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
  const wasLive = state.post?.status === "published";
  state.saving = true;
  els.save.disabled = true;
  els.save.textContent = "Saving…";
  els.saveState.textContent = "";

  try {
    const saved = isNew ? await admin.posts.create(data) : await admin.posts.update(postId, data);

    if (state.galleryChanged) {
      try {
        await admin.posts.setMedia(saved.id, state.gallery.map((g) => g.media_id));
        state.galleryChanged = false;
      } catch (error) {
        toast(`Post saved, but the photos didn't: ${error.message}`, "error");
      }
    }

    const message =
      typeof SAVED_MESSAGES[data.status] === "function"
        ? SAVED_MESSAGES[data.status](wasLive)
        : SAVED_MESSAGES[data.status];

    state.dirty = false;

    if (isNew) {
      flash(message);
      window.location.replace(`${SITE_BASE}admin/post-edit.html?id=${encodeURIComponent(saved.id)}`);
      return;
    }

    state.post = saved;
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

async function deletePost() {
  const ok = await confirmDialog({
    title: "Delete this post?",
    message: `“${state.post?.title || "Untitled post"}” will be removed from the website and can't be recovered.`,
    confirmLabel: "Delete post",
    danger: true,
  });
  if (!ok) return;
  try {
    await admin.posts.remove(postId);
    state.dirty = false;
    flash("Post deleted");
    window.location.replace(`${SITE_BASE}admin/posts.html`);
  } catch (error) {
    toast(error.message || "Couldn't delete the post.", "error");
  }
}

/* ---------------- Fill the page ---------------- */

function fillHeader() {
  const heading = isNew ? "New post" : "Edit post";
  els.title.textContent = heading;
  setAdminTitle(isNew ? "New post" : state.post?.title || "Edit post");

  if (isNew || !state.post) {
    els.headActions.innerHTML = "";
    return;
  }
  const live = state.post?.status === "published";
  els.headActions.innerHTML = `
    ${live ? `<a class="button button--quiet" href="${escapeHtml(urls.post(state.post.slug))}" target="_blank" rel="noopener">View on website</a>` : ""}
    <button type="button" class="button button--quiet button--danger-quiet" data-delete-post>Delete post</button>`;
  els.headActions.querySelector("[data-delete-post]").addEventListener("click", deletePost);
}

function options(list, { placeholder, label = (x) => x.name, selected = "" }) {
  return (
    (placeholder !== undefined ? `<option value="">${escapeHtml(placeholder)}</option>` : "") +
    list
      .map((x) => `<option value="${escapeHtml(x.id)}" ${x.id === selected ? "selected" : ""}>${escapeHtml(label(x))}</option>`)
      .join("")
  );
}

function fillSelects({ categories, authors, events, post }) {
  const byName = (a, b) => a.name.localeCompare(b.name);

  if (categories.length) {
    f("category_id").innerHTML = options([...categories].sort(byName), {
      placeholder: "Choose a category",
      selected: post?.category_id,
    });
  } else {
    f("category_id").innerHTML = `<option value="">No categories yet</option>`;
    setFieldError("category_id", "Create a category first under Categories.");
  }

  if (authors.length) {
    f("author_id").innerHTML = options([...authors].sort(byName), {
      placeholder: "Choose an author",
      selected: post?.author_id || (authors.length === 1 ? authors[0].id : ""),
    });
  } else {
    f("author_id").innerHTML = `<option value="">No authors yet</option>`;
    setFieldError("author_id", "Add an author first under Authors.");
  }

  const sortedEvents = [...events].sort((a, b) => new Date(b.start_at) - new Date(a.start_at));
  f("event_id").innerHTML = options(sortedEvents, {
    placeholder: "No related event",
    label: (e) => `${e.title} (${new Date(e.start_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" })})`,
    selected: post?.event_id,
  });
}

function fillForm(post) {
  f("title").value = post.title || "";
  f("slug").value = post.slug || "";
  f("excerpt").value = post.excerpt || "";
  f("content").value = post.content || "";
  f("featured").checked = Boolean(post.featured);
  f("video_url").value = post.video_url || "";
  f("scheduled_at").value = toLagosInput(post.scheduled_at);
  setStatus(post.status || "draft");
  updateExcerptCount();
}

async function load() {
  const stop = showLoading(els.loadState, { lines: 6 });
  try {
    const [categories, authors, events, post, media] = await Promise.all([
      admin.categories.list(),
      admin.authors.list(),
      admin.events.list().catch(() => []),
      isNew ? null : admin.posts.get(postId),
      isNew ? [] : admin.posts.getMedia(postId).catch(() => []),
    ]);
    stop();
    els.loadState.innerHTML = "";

    state.post = post;
    fillSelects({ categories, authors, events, post });

    if (post) {
      fillForm(post);
      if (post.featured_media_id) {
        const m = post.featured_media_url
          ? { id: post.featured_media_id, public_url: post.featured_media_url }
          : await findMedia(post.featured_media_id);
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
          <p>This post doesn't exist. It may have been deleted.</p>
          <a class="button" href="${SITE_BASE}admin/posts.html">Back to posts</a>
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
