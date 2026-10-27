/**
 * "Edit caption" window, used by the Media library and the Gallery admin.
 * Location: js/admin/caption-editor.js
 *
 * editCaption(media) opens a small window with the photo, a Caption box
 * (the write-up shown under the photo on the website) and a Description box
 * (for screen readers). Saving sends PATCH /admin/media/{id}.
 * Resolves with the updated photo, or null if nothing was saved.
 *
 * Until the backend has that endpoint (see docs/backend-edit-caption.md),
 * saving shows a clear message instead of failing silently.
 */

import { admin, ApiError } from "../api.js";

let dialog = null;

function build() {
  dialog = document.createElement("dialog");
  dialog.className = "caption-editor";
  dialog.setAttribute("aria-labelledby", "caption-editor-title");
  dialog.innerHTML = `
    <form class="caption-editor__body" data-caption-form novalidate>
      <div class="caption-editor__head">
        <h2 class="caption-editor__title" id="caption-editor-title">Edit caption</h2>
        <button type="button" class="picker__close" data-caption-cancel aria-label="Close">&times;</button>
      </div>
      <div class="caption-editor__layout">
        <img class="caption-editor__img" alt="" data-caption-img>
        <div class="caption-editor__fields">
          <div class="field">
            <label class="field__label" for="caption-editor-caption">Caption</label>
            <textarea class="field__input" id="caption-editor-caption" name="caption" rows="3" maxlength="500"
              placeholder="For example: Royal fathers at the Orlu Land honours night, Orlu Civic Centre"></textarea>
            <p class="field__hint">The write-up shown under the photo in the Gallery, and in posts and events that use it. Leave empty for no caption.</p>
          </div>
          <div class="field">
            <label class="field__label" for="caption-editor-alt">Description of the image</label>
            <input class="field__input" id="caption-editor-alt" name="alt_text" maxlength="500"
              placeholder="For example: Traditional rulers in red caps seated at a ceremony">
            <p class="field__hint">Read aloud to people using screen readers. Describe what's in the photo.</p>
          </div>
          <p class="notice notice--error" role="alert" data-caption-error hidden></p>
        </div>
      </div>
      <div class="confirm__actions">
        <button type="button" class="button button--quiet" data-caption-cancel>Cancel</button>
        <button type="submit" class="button" data-caption-save>Save caption</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

function explain(error) {
  if (error instanceof ApiError) {
    // 405 (or a bare 404 "Not Found" from the router) means the endpoint isn't there yet.
    const routeMissing =
      error.status === 405 || (error.status === 404 && /^not found$/i.test(String(error.body?.detail || "")));
    if (routeMissing) {
      return "Editing captions isn't switched on in the backend yet. Ask whoever manages the backend to add the \"edit photo\" endpoint (see docs/backend-edit-caption.md in the website folder). Until then, upload the photo again with its caption.";
    }
    if (error.status === 404) return "This photo no longer exists. It may have been deleted.";
    if (error.status === 401 || error.status === 403) return "Your sign-in has expired. Sign in again and retry.";
    if (error.status === 422) return "That caption couldn't be saved. Keep it under 500 characters.";
    return error.message || "The caption couldn't be saved. Please try again.";
  }
  return "The caption couldn't be saved. Please try again.";
}

/** @param {{id:string, public_url:string, caption?:string|null, alt_text?:string|null}} media */
export function editCaption(media) {
  const box = dialog || build();
  const form = box.querySelector("[data-caption-form]");
  const err = box.querySelector("[data-caption-error]");
  const save = box.querySelector("[data-caption-save]");
  const img = box.querySelector("[data-caption-img]");

  img.src = media.public_url;
  img.alt = media.alt_text || "";
  form.elements.caption.value = media.caption || "";
  form.elements.alt_text.value = media.alt_text || "";
  err.hidden = true;
  save.disabled = false;
  save.textContent = "Save caption";

  return new Promise((resolve) => {
    let result = null;

    const onCancel = () => box.close();
    const onSubmit = async (e) => {
      e.preventDefault();
      err.hidden = true;
      save.disabled = true;
      save.textContent = "Saving…";
      try {
        const caption = form.elements.caption.value.trim();
        const alt = form.elements.alt_text.value.trim();
        const updated = await admin.media.update(media.id, { caption: caption || null, alt_text: alt || null });
        result = updated?.id ? updated : { ...media, caption: caption || null, alt_text: alt || null };
        box.close();
      } catch (error) {
        err.textContent = explain(error);
        err.hidden = false;
        save.disabled = false;
        save.textContent = "Save caption";
      }
    };

    box.querySelectorAll("[data-caption-cancel]").forEach((b) => b.addEventListener("click", onCancel));
    form.addEventListener("submit", onSubmit);
    box.addEventListener(
      "close",
      () => {
        box.querySelectorAll("[data-caption-cancel]").forEach((b) => b.removeEventListener("click", onCancel));
        form.removeEventListener("submit", onSubmit);
        resolve(result);
      },
      { once: true },
    );

    box.showModal();
    form.elements.caption.focus();
  });
}

