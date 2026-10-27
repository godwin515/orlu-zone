/**
 * Media library: upload, browse and delete images.
 * Location: js/admin/media.js   (loaded by admin/media.html)
 *
 * GET    /admin/media          list
 * POST   /admin/media          upload (multipart: file, caption, alt_text)
 * DELETE /admin/media/{id}     delete (204)
 *
 * The API has no way to edit a caption or description after upload, so
 * they're asked for before uploading.
 *
 * Before deleting, the page checks where the image is used (featured
 * images, the gallery, author photos, Leadership photos, the site logo)
 * and warns. The backend refuses to delete Leadership photos, so those
 * are blocked up front with an explanation.
 * Photos inside post/event galleries aren't checked: that would need one
 * request per post and event.
 */

import { admin, api, adapters, formatDate, ApiError } from "../api.js";
import { escapeHtml, safeUrl, showLoading, showError } from "../ui.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import { confirmDialog, toast } from "./admin-ui.js";
import { editCaption } from "./caption-editor.js";

const BATCH = 40;

const els = {
  dropzone: document.querySelector("[data-dropzone]"),
  fileInput: document.querySelector("[data-file-input]"),
  queue: document.querySelector("[data-queue]"),
  queueList: document.querySelector("[data-queue-list]"),
  uploadAll: document.querySelector("[data-upload-all]"),
  clearQueue: document.querySelector("[data-clear-queue]"),
  q: document.querySelector("[data-filter-q]"),
  count: document.querySelector("[data-count]"),
  library: document.querySelector("[data-library]"),
  more: document.querySelector("[data-load-more]"),
  moreButton: document.querySelector("[data-load-more-button]"),
  details: document.querySelector("[data-details]"),
};

const state = {
  media: [],
  shown: BATCH,
  queue: [], // { key, file, previewUrl, alt, caption, status: "ready"|"uploading"|"done"|"error", error }
  usage: null, // cached usage lookup
  current: null, // media shown in the details dialog
};

/* ---------------- Formatting ---------------- */

function fileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const displayName = (m) => m.caption || m.original_filename || "Image";

/* ---------------- Upload queue ---------------- */

let keyCounter = 0;

function addFiles(files) {
  for (const file of files) {
    const problem = adapters.validateUpload(file);
    if (problem) {
      toast(`${file.name}: ${problem}`, "error");
      continue;
    }
    state.queue.push({
      key: ++keyCounter,
      file,
      previewUrl: URL.createObjectURL(file),
      alt: "",
      caption: "",
      status: "ready",
    });
  }
  renderQueue();
  els.queueList.querySelector("input")?.focus();
}

function renderQueue() {
  const items = state.queue;
  els.queue.hidden = !items.length;
  const ready = items.filter((q) => q.status === "ready" || q.status === "error").length;
  els.uploadAll.textContent = ready > 1 ? `Upload ${ready} images` : "Upload";
  els.uploadAll.disabled = !ready;

  els.queueList.innerHTML = items
    .map(
      (q) => `
      <li class="queue__item queue__item--${q.status}" data-key="${q.key}">
        <img class="queue__thumb" src="${escapeHtml(q.previewUrl)}" alt="">
        <div class="queue__fields">
          <p class="queue__name">${escapeHtml(q.file.name)} <span>${fileSize(q.file.size)}</span></p>
          <div class="field">
            <label class="field__label field__label--small" for="alt-${q.key}">Description of the image</label>
            <input class="field__input" id="alt-${q.key}" data-alt value="${escapeHtml(q.alt)}"
              placeholder="For example: Women's wing members at the clinic handover" ${q.status === "done" || q.status === "uploading" ? "disabled" : ""}>
          </div>
          <div class="field">
            <label class="field__label field__label--small" for="caption-${q.key}">Caption: the write-up shown under the photo <span class="field__optional">optional</span></label>
            <input class="field__input" id="caption-${q.key}" data-caption value="${escapeHtml(q.caption)}"
              placeholder="For example: Royal fathers at the Orlu Land honours night, Orlu Civic Centre"
              ${q.status === "done" || q.status === "uploading" ? "disabled" : ""}>
          </div>
          ${q.status === "error" ? `<p class="field__error">${escapeHtml(q.error)}</p>` : ""}
        </div>
        <div class="queue__state">
          ${
            q.status === "uploading"
              ? '<span class="queue__badge">Uploading…</span>'
              : q.status === "done"
                ? '<span class="queue__badge queue__badge--done">Uploaded</span>'
                : `<button type="button" class="icon-button icon-button--danger" data-remove-queued aria-label="Remove ${escapeHtml(q.file.name)}">&times;</button>`
          }
        </div>
      </li>`,
    )
    .join("");
}

els.queueList.addEventListener("input", (e) => {
  const item = state.queue.find((q) => q.key === Number(e.target.closest("[data-key]")?.dataset.key));
  if (!item) return;
  if (e.target.matches("[data-alt]")) item.alt = e.target.value;
  if (e.target.matches("[data-caption]")) item.caption = e.target.value;
});

els.queueList.addEventListener("click", (e) => {
  if (!e.target.closest("[data-remove-queued]")) return;
  const key = Number(e.target.closest("[data-key]").dataset.key);
  const item = state.queue.find((q) => q.key === key);
  if (item) URL.revokeObjectURL(item.previewUrl);
  state.queue = state.queue.filter((q) => q.key !== key);
  renderQueue();
});

els.clearQueue.addEventListener("click", () => {
  state.queue.forEach((q) => URL.revokeObjectURL(q.previewUrl));
  state.queue = [];
  renderQueue();
});

els.uploadAll.addEventListener("click", async () => {
  const pending = state.queue.filter((q) => q.status === "ready" || q.status === "error");
  if (!pending.length) return;

  const missingAlt = pending.filter((q) => !q.alt.trim()).length;
  if (missingAlt) {
    const ok = await confirmDialog({
      title: "Upload without descriptions?",
      message: `${missingAlt} ${missingAlt === 1 ? "image has" : "images have"} no description. Descriptions help people who use screen readers and help search engines. You can't add them after uploading.`,
      confirmLabel: "Upload anyway",
    });
    if (!ok) return;
  }

  els.uploadAll.disabled = true;
  els.clearQueue.disabled = true;
  let done = 0;

  // One at a time: gentler on a sleepy server and on mobile data.
  for (const item of pending) {
    item.status = "uploading";
    renderQueue();
    try {
      const media = await admin.media.upload(item.file, {
        alt_text: item.alt.trim() || undefined,
        caption: item.caption.trim() || undefined,
      });
      item.status = "done";
      state.media.unshift(media);
      done += 1;
    } catch (error) {
      item.status = "error";
      item.error = error.message || "Upload failed.";
    }
    renderQueue();
  }

  els.clearQueue.disabled = false;
  renderLibrary();
  const failed = state.queue.filter((q) => q.status === "error").length;
  if (done) toast(`${done} ${done === 1 ? "image" : "images"} uploaded`);
  if (failed) toast(`${failed} ${failed === 1 ? "image" : "images"} didn't upload. Fix and try again.`, "error");

  // Clear finished items after a moment, keep failed ones for retrying.
  setTimeout(() => {
    state.queue
      .filter((q) => q.status === "done")
      .forEach((q) => URL.revokeObjectURL(q.previewUrl));
    state.queue = state.queue.filter((q) => q.status !== "done");
    renderQueue();
  }, 1500);
});

/* Drag and drop + file input */
els.fileInput.addEventListener("change", () => {
  addFiles([...els.fileInput.files]);
  els.fileInput.value = "";
});
["dragenter", "dragover"].forEach((type) =>
  els.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("is-over");
  }),
);
["dragleave", "drop"].forEach((type) =>
  els.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("is-over");
  }),
);
els.dropzone.addEventListener("drop", (e) => addFiles([...(e.dataTransfer?.files || [])]));

/* ---------------- Library grid ---------------- */

function filtered() {
  const q = els.q.value.trim().toLowerCase();
  if (!q) return state.media;
  return state.media.filter((m) =>
    [m.original_filename, m.caption, m.alt_text].some((v) => (v || "").toLowerCase().includes(q)),
  );
}

function renderLibrary() {
  const list = filtered();
  const total = state.media.length;

  if (!total) {
    els.count.textContent = "";
    els.more.hidden = true;
    els.library.innerHTML = `<div class="empty-block"><p>No images yet. Upload your first photos above.</p></div>`;
    return;
  }
  if (!list.length) {
    els.count.textContent = "";
    els.more.hidden = true;
    els.library.innerHTML = `<div class="empty-block"><p>No images match “${escapeHtml(els.q.value)}”.</p></div>`;
    return;
  }

  const shown = list.slice(0, state.shown);
  els.count.textContent =
    list.length === total
      ? `${total} ${total === 1 ? "image" : "images"}`
      : `${list.length} of ${total} images match`;

  els.library.innerHTML = `
    <ul class="media-grid">
      ${shown
        .map(
          (m) => `
        <li>
          <button type="button" class="media-tile" data-media-id="${escapeHtml(m.id)}"
            aria-label="${escapeHtml(`${displayName(m)}, open details`)}">
            <img src="${safeUrl(m.public_url)}" alt="" loading="lazy">
            <span class="media-tile__meta">
              <span class="media-tile__name">${escapeHtml(displayName(m))}</span>
              <span class="media-tile__sub">${[m.width && m.height ? `${m.width}×${m.height}` : "", fileSize(m.file_size)].filter(Boolean).join(", ")}</span>
            </span>
            ${m.alt_text ? "" : '<span class="media-tile__flag">No description</span>'}
          </button>
        </li>`,
        )
        .join("")}
    </ul>`;
  els.more.hidden = shown.length >= list.length;
}

let qTimer;
els.q.addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    state.shown = BATCH;
    renderLibrary();
  }, 150);
});

els.moreButton.addEventListener("click", () => {
  state.shown += BATCH;
  renderLibrary();
});

/* ---------------- Where is an image used? ---------------- */

async function loadUsage() {
  if (state.usage) return state.usage;
  const [posts, events, gallery, authors, profiles, site] = await Promise.all([
    admin.posts.list().catch(() => []),
    admin.events.list().catch(() => []),
    admin.gallery.list().catch(() => []),
    admin.authors.list().catch(() => []),
    admin.profiles.list().catch(() => []),
    api.getSite().catch(() => null),
  ]);
  state.usage = { posts, events, gallery, authors, profiles, site };
  return state.usage;
}

function usesOf(id, u) {
  const uses = [];
  u.posts.filter((p) => p.featured_media_id === id).forEach((p) => uses.push(`Featured image of the post “${p.title}”`));
  u.events.filter((e) => e.featured_media_id === id).forEach((e) => uses.push(`Featured image of the event “${e.title}”`));
  if (u.gallery.some((g) => g.media_id === id)) uses.push("In the website gallery");
  u.authors.filter((a) => a.profile_media_id === id).forEach((a) => uses.push(`Profile photo of ${a.name}`));
  (u.profiles || [])
    .filter((p) => p.profile_media_id === id)
    .forEach((p) => uses.push(`Leadership photo of ${p.name}`));
  if (u.site?.logo_media_id === id) uses.push("The site logo");
  return uses;
}

/* ---------------- Details dialog ---------------- */

const d = {
  img: els.details.querySelector("[data-details-img]"),
  title: els.details.querySelector("[data-details-title]"),
  facts: els.details.querySelector("[data-details-facts]"),
  usage: els.details.querySelector("[data-details-usage]"),
  copy: els.details.querySelector("[data-copy-url]"),
  open: els.details.querySelector("[data-open-url]"),
  del: els.details.querySelector("[data-delete-media]"),
  edit: els.details.querySelector("[data-edit-caption]"),
};

async function openDetails(id) {
  const m = state.media.find((x) => x.id === id);
  if (!m) return;
  state.current = m;

  d.img.src = m.public_url;
  d.img.alt = m.alt_text || "";
  d.title.textContent = displayName(m);
  d.open.href = m.public_url;
  d.copy.textContent = "Copy image link";

  const fact = (label, value) => (value ? `<div><dt>${label}</dt><dd>${escapeHtml(String(value))}</dd></div>` : "");
  d.facts.innerHTML = [
    fact("Caption", m.caption || "None yet. Click Edit caption to add one."),
    fact("Description", m.alt_text || "None yet."),
    fact("File", m.original_filename),
    fact("Size", [m.width && m.height ? `${m.width} × ${m.height} pixels` : "", fileSize(m.file_size)].filter(Boolean).join(", ")),
    fact("Uploaded", m.created_at ? formatDate(m.created_at, { dateStyle: "medium", timeStyle: "short" }) : ""),
  ].join("");

  d.usage.innerHTML = `<p class="field__hint">Checking where this image is used…</p>`;
  els.details.showModal();

  try {
    const uses = usesOf(m.id, await loadUsage());
    if (state.current !== m) return;
    d.usage.innerHTML = uses.length
      ? `<p class="media-details__usage-title">Used in:</p><ul>${uses.map((u) => `<li>${escapeHtml(u)}</li>`).join("")}</ul>`
      : `<p class="field__hint">Not used as a featured image, profile photo, logo or in the gallery.</p>`;
    d.usage.dataset.count = String(uses.length);
  } catch {
    d.usage.innerHTML = "";
  }
}

els.library.addEventListener("click", (e) => {
  const tile = e.target.closest("[data-media-id]");
  if (tile) openDetails(tile.dataset.mediaId);
});

els.details.querySelector("[data-details-close]").addEventListener("click", () => els.details.close());
els.details.addEventListener("click", (e) => {
  if (e.target === els.details) els.details.close();
});

d.edit.addEventListener("click", async () => {
  const m = state.current;
  if (!m) return;
  els.details.close();
  const updated = await editCaption(m);
  if (updated) {
    const i = state.media.findIndex((x) => x.id === m.id);
    if (i >= 0) state.media[i] = { ...state.media[i], ...updated };
    renderLibrary();
    toast("Caption saved");
  }
  openDetails(m.id);
});

d.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.current.public_url);
    d.copy.textContent = "Link copied";
  } catch {
    d.copy.textContent = "Copy failed";
  }
});

d.del.addEventListener("click", async () => {
  const m = state.current;
  if (!m) return;
  const uses = usesOf(m.id, await loadUsage().catch(() => ({ posts: [], events: [], gallery: [], authors: [], profiles: [], site: null })));

  // The backend refuses to delete an image used as a Leadership photo.
  const profileUses = uses.filter((u) => u.startsWith("Leadership photo of"));
  if (profileUses.length) {
    els.details.close();
    await confirmDialog({
      title: "This image can't be deleted yet",
      message: `It's the ${profileUses.join("; ")}. The server won't delete it while it's in use. Change or remove that photo under Leadership first.`,
      confirmLabel: "OK",
    });
    els.details.showModal();
    return;
  }

  els.details.close();
  const ok = await confirmDialog({
    title: "Delete this image?",
    message: uses.length
      ? `It's still used in ${uses.length} ${uses.length === 1 ? "place" : "places"} (${uses.join("; ")}). Those spots may show a broken image. It may also be in a post or event's photos. This can't be undone.`
      : "It may still be in a post or event's photos, where it would disappear. This can't be undone.",
    confirmLabel: "Delete image",
    danger: true,
  });
  if (!ok) {
    els.details.showModal();
    return;
  }

  try {
    await admin.media.remove(m.id);
    state.media = state.media.filter((x) => x.id !== m.id);
    state.usage = null; // usage may have changed
    renderLibrary();
    toast("Image deleted");
  } catch (error) {
    const inUse = error instanceof ApiError && [400, 409, 422].includes(error.status);
    toast(
      inUse
        ? `The server won't delete this image because it's still in use${error.message ? ` (${error.message})` : ""}. It may be a Leadership photo: change that first.`
        : error.message || "Couldn't delete the image.",
      "error",
    );
    state.usage = null;
  }
});

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.library, { lines: 4 });
  try {
    const media = await admin.media.list();
    stop();
    state.media = [...media].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    renderLibrary();
  } catch (error) {
    stop();
    showError(els.library, error, load);
  }
}

// Leaving with uploads still queued? Warn, as those files aren't saved yet.
window.addEventListener("beforeunload", (e) => {
  if (state.queue.some((q) => q.status === "ready" || q.status === "uploading")) {
    e.preventDefault();
    e.returnValue = "";
  }
});

const user = await requireAdmin();
renderAdminLayout(user);
setAdminTitle("Media library");
load();
