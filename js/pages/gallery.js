/**
 * Gallery page.
 * Location: js/pages/gallery.js   (loaded by gallery.html)
 *
 * Loads /gallery once (in the order the admin set) and shows 24 photos
 * at a time with a "Show more photos" button. Every photo, including ones
 * uploaded later, gets the same framed card (styles: "Gallery page" in
 * css/site.css). Photos open in the shared full-screen viewer from
 * js/lightbox.js, which shows the whole, uncropped photo.
 */

import { api } from "../api.js";
import { renderShell, initShell, showLoading, showEmpty, showError, escapeHtml, safeUrl } from "../ui.js";
import { attachLightbox } from "../lightbox.js";

const BATCH = 24;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const els = {
  count: document.querySelector("[data-count]"),
  gallery: document.querySelector("[data-gallery]"),
  more: document.querySelector("[data-load-more]"),
  moreButton: document.querySelector("[data-load-more-button]"),
};

const state = { images: [], shown: BATCH, seen: 0 };

const VIEW_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;

function cardHtml(img, i) {
  const number = String(i + 1).padStart(2, "0");
  const caption = img.caption || "";
  const alt = img.alt_text || caption || `Orlu Land photo ${number}`;
  return `
    <li class="gallery-card">
      <a class="photo-grid__item gallery-card__frame" href="${safeUrl(img.public_url)}" data-index="${i}"
        data-caption="${escapeHtml(caption)}" data-alt="${escapeHtml(alt)}"
        aria-label="View photo ${number}${caption ? `: ${escapeHtml(caption)}` : ""} full size">
        <img src="${safeUrl(img.public_url)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"
          ${img.width && img.height ? `width="${Number(img.width)}" height="${Number(img.height)}"` : ""}>
        <span class="gallery-card__view" aria-hidden="true">${VIEW_ICON}<span>View photo</span></span>
      </a>
      ${caption ? `
      <div class="gallery-card__plate">
        <span class="gallery-card__rule" aria-hidden="true"></span>
        <div class="gallery-card__caption">
          <p class="gallery-card__text" id="gallery-caption-${i}" data-full="${escapeHtml(caption)}"><span data-caption-words>${escapeHtml(caption)}</span><button type="button" class="gallery-card__more" data-caption-toggle aria-expanded="false"
            aria-controls="gallery-caption-${i}" hidden>more</button></p>
        </div>
      </div>` : ""}
    </li>`;
}

/* Cards rise into view as they scroll on screen; a small stagger along each row. */
let observer = null;
function animateIn(wall) {
  const cards = [...wall.querySelectorAll(".gallery-card")];
  if (reduceMotion.matches || !("IntersectionObserver" in window)) return;
  wall.classList.add("is-animated");
  // Cards already shown before "Show more" stay visible without replaying.
  cards.slice(0, state.seen).forEach((c) => c.classList.add("is-visible"));
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      let n = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.style.setProperty("--delay", `${Math.min(n++, 3) * 0.12}s`);
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  cards.slice(state.seen).forEach((c) => observer.observe(c));
}

function render() {
  const total = state.images.length;
  const shown = Math.min(state.shown, total);

  els.count.textContent =
    shown < total ? `Showing ${shown} of ${total} photos` : `${total} ${total === 1 ? "photo" : "photos"}`;

  els.gallery.innerHTML = `<ul class="gallery-wall" data-photo-grid>${state.images
    .slice(0, shown)
    .map(cardHtml)
    .join("")}</ul>`;
  attachLightbox(els.gallery);
  animateIn(els.gallery.querySelector(".gallery-wall"));
  markLongCaptions();
  state.seen = shown;
  els.more.hidden = shown >= total;
}

/* ---------------- Captions: two lines, then "more" ----------------
 * Each caption shows up to two lines. If it's longer, it's cut at a word so
 * that "… more" ends the second line; tapping it shows the rest, and "less"
 * folds it back. Re-measured when the screen size changes, since the number
 * of lines depends on the width.
 */
const LINES = 2;

function linesOf(el) {
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
  return Math.round(el.getBoundingClientRect().height / lh);
}

function fitCaption(p) {
  const words = p.querySelector("[data-caption-words]");
  const button = p.querySelector("[data-caption-toggle]");
  const full = p.dataset.full || "";
  if (p.closest(".gallery-card__caption").classList.contains("is-open")) return;

  // Fits as it is? Then no "more".
  words.textContent = full;
  button.hidden = true;
  if (linesOf(p) <= LINES) return;

  // Longest run of words that fits on two lines together with "… more".
  button.hidden = false;
  button.textContent = "more";
  const parts = full.split(/\s+/);
  let lo = 1;
  let hi = parts.length - 1;
  let best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    words.textContent = `${parts.slice(0, mid).join(" ")}… `;
    if (linesOf(p) <= LINES) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  words.textContent = `${parts.slice(0, best).join(" ").replace(/[,;:.\s]+$/, "")}… `;
}

function markLongCaptions() {
  els.gallery.querySelectorAll(".gallery-card__text[data-full]").forEach(fitCaption);
}

els.gallery.addEventListener("click", (e) => {
  const button = e.target.closest("[data-caption-toggle]");
  if (!button) return;
  const p = button.closest(".gallery-card__text");
  const box = button.closest(".gallery-card__caption");
  const open = !box.classList.contains("is-open");
  box.classList.toggle("is-open", open);
  button.setAttribute("aria-expanded", String(open));
  if (open) {
    p.querySelector("[data-caption-words]").textContent = `${p.dataset.full} `;
    button.textContent = "less";
  } else {
    fitCaption(p);
  }
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(markLongCaptions, 150);
});
// Web fonts can change line breaks once they load.
document.fonts?.ready?.then(markLongCaptions);

els.moreButton.addEventListener("click", () => {
  const firstNew = state.shown;
  state.shown += BATCH;
  render();
  // Move keyboard focus to the first new photo so keyboard users don't lose their place.
  els.gallery.querySelectorAll(".gallery-card__frame")[firstNew]?.focus();
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
    state.seen = 0;

    if (!state.images.length) {
      showEmpty(els.gallery, "No photos have been added to the gallery yet.", {
        href: "/events.html",
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
initShell().then((site) => {
  if (site?.community_name) document.title = `Gallery | ${site.community_name}`;
});
load();
