/**
 * Photo grid with a full-screen viewer.
 * Location: js/lightbox.js
 * Used by the post, event and gallery pages.
 *
 * Expects GalleryImageResponse objects:
 *   { media_id, sort_order, public_url, caption, alt_text, width, height }
 */

import { escapeHtml, safeUrl } from "./ui.js";

/**
 * @param {Array} images
 * @param {{captions?: boolean}} [opts]  show each caption under its photo
 */
export function photoGrid(images, { captions = false } = {}) {
  const list = [...(images || [])]
    .filter((img) => img?.public_url)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (!list.length) return "";

  return `
    <ul class="photo-grid${captions ? " photo-grid--captions" : ""}" data-photo-grid>
      ${list
        .map(
          (img, i) => `
        <li>
          <a class="photo-grid__item" href="${safeUrl(img.public_url)}" data-index="${i}"
            data-caption="${escapeHtml(img.caption || "")}" data-alt="${escapeHtml(img.alt_text || "")}">
            <img src="${safeUrl(img.public_url)}" alt="${escapeHtml(img.alt_text || img.caption || "")}"
              loading="lazy" ${img.width && img.height ? `width="${Number(img.width)}" height="${Number(img.height)}"` : ""}>
          </a>
          ${captions && img.caption ? `<p class="photo-grid__caption">${escapeHtml(img.caption)}</p>` : ""}
        </li>`,
        )
        .join("")}
    </ul>`;
}

let dialog = null;

function buildDialog() {
  dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", "Photo viewer");
  dialog.innerHTML = `
    <div class="lightbox__frame">
      <img class="lightbox__image" alt="">
      <p class="lightbox__caption"></p>
    </div>
    <button type="button" class="lightbox__button lightbox__close" data-close aria-label="Close">&times;</button>
    <button type="button" class="lightbox__button lightbox__prev" data-prev aria-label="Previous photo">&#8249;</button>
    <button type="button" class="lightbox__button lightbox__next" data-next aria-label="Next photo">&#8250;</button>
    <p class="lightbox__count" aria-live="polite"></p>`;
  document.body.appendChild(dialog);

  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close(); // click on the backdrop
  });
  return dialog;
}

/** Make a rendered photoGrid open full screen when a photo is clicked. */
export function attachLightbox(root) {
  const grid = root.querySelector("[data-photo-grid]");
  if (!grid) return;
  const items = [...grid.querySelectorAll(".photo-grid__item")];
  const box = dialog || buildDialog();
  const img = box.querySelector(".lightbox__image");
  const caption = box.querySelector(".lightbox__caption");
  const count = box.querySelector(".lightbox__count");
  let index = 0;

  const show = (i) => {
    index = (i + items.length) % items.length;
    const a = items[index];
    img.src = a.href;
    img.alt = a.dataset.alt || a.dataset.caption || "";
    caption.textContent = a.dataset.caption || "";
    caption.hidden = !a.dataset.caption;
    count.textContent = `${index + 1} of ${items.length}`;
    box.querySelector("[data-prev]").hidden = items.length < 2;
    box.querySelector("[data-next]").hidden = items.length < 2;
  };

  box.querySelector("[data-prev]").onclick = () => show(index - 1);
  box.querySelector("[data-next]").onclick = () => show(index + 1);
  box.onkeydown = (e) => {
    if (e.key === "ArrowLeft") show(index - 1);
    if (e.key === "ArrowRight") show(index + 1);
  };

  items.forEach((a, i) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      show(i);
      box.showModal();
    }),
  );
}
