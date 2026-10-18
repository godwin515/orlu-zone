/**
 * Gallery page.
 * Location: js/pages/gallery.js   (loaded by gallery.html)
 *
 * Loads /gallery once (in the order the admin set) and shows 24 photos
 * at a time with a "Show more photos" button. Photos open in the shared
 * full-screen viewer from js/lightbox.js.
 */

import { SITE_BASE } from "../config.js";
import { api } from "../api.js";
import { renderShell, initShell, showLoading, showEmpty, showError } from "../ui.js";
import { photoGrid, attachLightbox } from "../lightbox.js";

const BATCH = 24;

const els = {
  count: document.querySelector("[data-count]"),
  gallery: document.querySelector("[data-gallery]"),
  more: document.querySelector("[data-load-more]"),
  moreButton: document.querySelector("[data-load-more-button]"),
};

const state = { images: [], shown: BATCH };

function render() {
  const total = state.images.length;
  const shown = Math.min(state.shown, total);

  els.count.textContent =
    shown < total ? `Showing ${shown} of ${total} photos` : `${total} ${total === 1 ? "photo" : "photos"}`;

  els.gallery.innerHTML = photoGrid(state.images.slice(0, shown), { captions: true });
  attachLightbox(els.gallery);
  els.more.hidden = shown >= total;
}

els.moreButton.addEventListener("click", () => {
  const firstNew = state.shown;
  state.shown += BATCH;
  render();
  // Move keyboard focus to the first new photo so keyboard users don't lose their place.
  els.gallery.querySelectorAll(".photo-grid__item")[firstNew]?.focus();
});

async function load() {
  const stop = showLoading(els.gallery, { lines: 4 });
  els.count.textContent = "";
  els.more.hidden = true;

  try {
    const images = await api.getGallery();
    stop();
    state.images = (images || [])
      .filter((img) => img?.public_url)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    if (!state.images.length) {
      showEmpty(els.gallery, "No photos have been added to the gallery yet.", {
        href: `${SITE_BASE}events.html`,
        label: "See upcoming events",
      });
      return;
    }
    render();
  } catch (error) {
    stop();
    showError(els.gallery, error, load);
  }
}

renderShell();
initShell();
load();
