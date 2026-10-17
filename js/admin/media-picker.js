/**
 * Media picker: choose images from the library or upload new ones.
 * Location: js/admin/media-picker.js
 *
 *   const chosen = await pickMedia({ multiple: false, selected: [id] });
 *   // -> array of MediaResponse objects, or null if cancelled
 *
 * Lists GET /admin/media and uploads with POST /admin/media (multipart).
 * Newly uploaded images are selected automatically.
 * Used by the post editor (featured image, photos); events, authors and
 * site settings will reuse it.
 */

import { admin, adapters } from "../api.js";
import { escapeHtml, safeUrl } from "../ui.js";
import { toast } from "./admin-ui.js";

let dialog = null;
let library = null; // cached list for this page

/** Fetch the media library once per page (newest first). */
export async function loadLibrary(force = false) {
  if (!library || force) {
    const items = await admin.media.list();
    library = [...items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return library;
}

/** Find a media record by id from the cached library (loads it if needed). */
export async function findMedia(id) {
  if (!id) return null;
  try {
    const list = await loadLibrary();
    return list.find((m) => m.id === id) || (await admin.media.get(id));
  } catch {
    return null;
  }
}

function buildDialog() {
  dialog = document.createElement("dialog");
  dialog.className = "picker";
  dialog.setAttribute("aria-labelledby", "picker-title");
  dialog.innerHTML = `
    <div class="picker__head">
      <h2 class="picker__title" id="picker-title">Choose an image</h2>
      <button type="button" class="picker__close" data-picker-cancel aria-label="Close">&times;</button>
    </div>

    <div class="picker__upload">
      <label class="button button--quiet picker__upload-button">
        <input type="file" accept="image/jpeg,image/png,image/webp" data-picker-file hidden>
        Upload from your device
      </label>
      <p class="picker__hint">JPEG, PNG or WebP, up to 5 MB. New uploads are selected for you.</p>
      <p class="picker__progress" data-picker-progress role="status" hidden></p>
    </div>

    <div class="picker__body" data-picker-body></div>

    <div class="picker__foot">
      <p class="picker__count" data-picker-count aria-live="polite"></p>
      <div class="picker__actions">
        <button type="button" class="button button--quiet" data-picker-cancel>Cancel</button>
        <button type="button" class="button" data-picker-done disabled>Use image</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  return dialog;
}

/**
 * @param {{multiple?: boolean, selected?: string[], exclude?: string[], title?: string, doneLabel?: (count: number) => string}} [opts]
 *   exclude: media ids to leave out of the grid (e.g. photos already in the gallery)
 * @returns {Promise<object[]|null>}
 */
export function pickMedia({ multiple = false, selected = [], exclude = [], title, doneLabel } = {}) {
  const box = dialog || buildDialog();
  const body = box.querySelector("[data-picker-body]");
  const count = box.querySelector("[data-picker-count]");
  const done = box.querySelector("[data-picker-done]");
  const fileInput = box.querySelector("[data-picker-file]");
  const progress = box.querySelector("[data-picker-progress]");

  box.querySelector("#picker-title").textContent = title || (multiple ? "Choose photos" : "Choose an image");
  fileInput.multiple = multiple;

  // Order matters for multiple selection (it becomes the photo order).
  let chosen = [...selected];

  const updateFoot = () => {
    const n = chosen.length;
    count.textContent = multiple ? `${n} selected` : n ? "1 selected" : "";
    done.disabled = !multiple && n === 0;
    done.textContent = doneLabel
      ? doneLabel(n)
      : multiple
        ? n ? `Use ${n} ${n === 1 ? "photo" : "photos"}` : "Use no photos"
        : "Use image";
  };

  const tile = (m) => {
    const index = chosen.indexOf(m.id);
    const on = index !== -1;
    return `
      <li>
        <button type="button" class="picker__item${on ? " is-selected" : ""}" data-media-id="${escapeHtml(m.id)}"
          aria-pressed="${on}" title="${escapeHtml(m.original_filename || "")}">
          <img src="${safeUrl(m.public_url)}" alt="${escapeHtml(m.alt_text || m.caption || m.original_filename || "")}" loading="lazy">
          ${on ? `<span class="picker__badge">${multiple ? index + 1 : "✓"}</span>` : ""}
        </button>
      </li>`;
  };

  const hidden = new Set(exclude);
  const render = () => {
    const visible = (library || []).filter((m) => !hidden.has(m.id));
    if (!library?.length) {
      body.innerHTML = `<p class="picker__empty">No images yet. Upload one above.</p>`;
    } else if (!visible.length) {
      body.innerHTML = `<p class="picker__empty">Every image is already used here. Upload a new one above.</p>`;
    } else {
      body.innerHTML = `<ul class="picker__grid">${visible.map(tile).join("")}</ul>`;
    }
    updateFoot();
  };

  const toggle = (id) => {
    if (multiple) {
      chosen = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    } else {
      chosen = chosen[0] === id ? [] : [id];
    }
    render();
    body.querySelector(`[data-media-id="${CSS.escape(id)}"]`)?.focus();
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      body.onclick = null;
      fileInput.onchange = null;
      done.onclick = null;
      box.querySelectorAll("[data-picker-cancel]").forEach((b) => (b.onclick = null));
    };
    const finish = (result) => {
      cleanup();
      box.close();
      resolve(result);
    };

    body.onclick = (e) => {
      const item = e.target.closest("[data-media-id]");
      if (item) toggle(item.dataset.mediaId);
    };

    done.onclick = () => {
      const byId = new Map(library.map((m) => [m.id, m]));
      finish(chosen.map((id) => byId.get(id)).filter(Boolean));
    };

    box.querySelectorAll("[data-picker-cancel]").forEach((b) => (b.onclick = () => finish(null)));
    box.addEventListener("cancel", () => cleanup(), { once: true }); // Escape key
    box.addEventListener("close", () => resolve(null), { once: true }); // resolves null if not already resolved

    fileInput.onchange = async () => {
      const files = [...fileInput.files];
      fileInput.value = "";
      for (const [i, file] of files.entries()) {
        const problem = adapters.validateUpload(file);
        if (problem) {
          toast(`${file.name}: ${problem}`, "error");
          continue;
        }
        progress.hidden = false;
        progress.textContent = files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : `Uploading ${file.name}…`;
        try {
          const media = await admin.media.upload(file);
          library = [media, ...(library || [])];
          if (multiple) chosen = [...chosen, media.id];
          else chosen = [media.id];
          render();
        } catch (error) {
          toast(`${file.name}: ${error.message || "upload failed"}`, "error");
        }
      }
      progress.hidden = true;
    };

    body.innerHTML = `<p class="picker__empty">Loading images…</p>`;
    updateFoot();
    box.showModal();

    loadLibrary()
      .then(render)
      .catch((error) => {
        body.innerHTML = `<p class="picker__empty picker__empty--error">${escapeHtml(error.message || "Couldn't load images.")}</p>`;
      });
  });
}
