/**
 * Admin gallery: choose photos for the public Gallery page and order them.
 * Location: js/admin/gallery.js   (loaded by admin/gallery.html)
 *
 * GET    /admin/gallery              current photos (with sort_order)
 * POST   /admin/gallery              add one     { media_id }
 * DELETE /admin/gallery/{media_id}   remove one  (204; the image stays in the media library)
 * PATCH  /admin/gallery/order        save order  { media_ids: [...] } (204)
 *
 * Adding and removing save straight away. Reordering is done locally
 * (drag and drop, or arrow buttons) and saved with "Save order".
 */

import { admin } from "../api.js";
import { escapeHtml, safeUrl, showLoading, showError } from "../ui.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import { toast } from "./admin-ui.js";
import { pickMedia } from "./media-picker.js";

const els = {
  add: document.querySelector("[data-add]"),
  bar: document.querySelector("[data-order-bar]"),
  saveOrder: document.querySelector("[data-save-order]"),
  undo: document.querySelector("[data-undo-order]"),
  count: document.querySelector("[data-count]"),
  how: document.querySelector("[data-how]"),
  grid: document.querySelector("[data-gallery]"),
};

const state = {
  items: [], // current order on screen: [{ media_id, public_url, alt_text, caption }]
  savedOrder: [], // media_ids as last saved on the server
  busy: false,
};

const ids = () => state.items.map((i) => i.media_id);
const orderChanged = () => ids().join() !== state.savedOrder.join();

/* ---------------- Rendering ---------------- */

function render({ focusId } = {}) {
  const n = state.items.length;
  els.count.textContent = n ? `${n} ${n === 1 ? "photo" : "photos"} in the gallery` : "";
  els.how.hidden = n < 2;
  els.bar.hidden = !orderChanged();

  if (!n) {
    els.grid.innerHTML = `
      <div class="empty-block">
        <p>The gallery is empty. Add photos from the media library and they'll appear on the website's Gallery page.</p>
        <button type="button" class="button" data-add-empty>Add photos</button>
      </div>`;
    return;
  }

  const last = n - 1;
  els.grid.innerHTML = `
    <ol class="sort-grid" data-sort-grid>
      ${state.items
        .map(
          (item, i) => `
        <li class="sort-grid__item" draggable="true" data-id="${escapeHtml(item.media_id)}">
          <span class="sort-grid__number" aria-hidden="true">${i + 1}</span>
          <img src="${safeUrl(item.public_url)}" alt="${escapeHtml(item.alt_text || "")}" draggable="false" loading="lazy">
          ${item.caption ? `<p class="sort-grid__caption">${escapeHtml(item.caption)}</p>` : ""}
          <div class="thumb-list__actions">
            <button type="button" class="icon-button" data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""}
              aria-label="Move photo ${i + 1} earlier">&larr;</button>
            <button type="button" class="icon-button" data-move="${i}" data-dir="1" ${i === last ? "disabled" : ""}
              aria-label="Move photo ${i + 1} later">&rarr;</button>
            <button type="button" class="icon-button icon-button--danger" data-remove="${escapeHtml(item.media_id)}"
              aria-label="Remove photo ${i + 1} from the gallery">&times;</button>
          </div>
        </li>`,
        )
        .join("")}
    </ol>`;

  if (focusId) {
    // Keep keyboard focus on the moved photo's same button.
    const tile = els.grid.querySelector(`[data-id="${CSS.escape(focusId.id)}"]`);
    const same = tile?.querySelector(`[data-dir="${focusId.dir}"]:not(:disabled)`);
    (same || tile?.querySelector("[data-dir]:not(:disabled)"))?.focus();
  }
}

/* ---------------- Reorder: arrow buttons ---------------- */

els.grid.addEventListener("click", (e) => {
  const move = e.target.closest("[data-move]");
  if (move) {
    const i = Number(move.dataset.move);
    const j = i + Number(move.dataset.dir);
    const id = state.items[i].media_id;
    [state.items[i], state.items[j]] = [state.items[j], state.items[i]];
    render({ focusId: { id, dir: move.dataset.dir } });
    return;
  }
  const remove = e.target.closest("[data-remove]");
  if (remove) removePhoto(remove.dataset.remove, remove);
  if (e.target.closest("[data-add-empty]")) addPhotos();
});

/* ---------------- Reorder: drag and drop ---------------- */

let dragId = null;

els.grid.addEventListener("dragstart", (e) => {
  const li = e.target.closest(".sort-grid__item");
  if (!li) return;
  dragId = li.dataset.id;
  li.classList.add("is-dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
});

els.grid.addEventListener("dragover", (e) => {
  const over = e.target.closest(".sort-grid__item");
  if (!dragId || !over || over.dataset.id === dragId) return;
  e.preventDefault();
  const from = state.items.findIndex((i) => i.media_id === dragId);
  const to = state.items.findIndex((i) => i.media_id === over.dataset.id);
  // Move live as the pointer passes over another photo.
  const [moved] = state.items.splice(from, 1);
  state.items.splice(to, 0, moved);
  render();
  els.grid.querySelector(`[data-id="${CSS.escape(dragId)}"]`)?.classList.add("is-dragging");
});

els.grid.addEventListener("drop", (e) => e.preventDefault());
els.grid.addEventListener("dragend", () => {
  dragId = null;
  render();
});

/* ---------------- Save / undo order ---------------- */

els.saveOrder.addEventListener("click", async () => {
  if (state.busy) return;
  state.busy = true;
  els.saveOrder.disabled = true;
  els.saveOrder.textContent = "Saving…";
  try {
    await admin.gallery.reorder(ids());
    state.savedOrder = ids();
    toast("Gallery order saved");
    render();
  } catch (error) {
    toast(error.message || "Couldn't save the order.", "error");
  } finally {
    state.busy = false;
    els.saveOrder.disabled = false;
    els.saveOrder.textContent = "Save order";
  }
});

els.undo.addEventListener("click", () => {
  const byId = new Map(state.items.map((i) => [i.media_id, i]));
  state.items = state.savedOrder.map((id) => byId.get(id)).filter(Boolean);
  render();
  toast("Order changes undone");
});

/* ---------------- Add ---------------- */

async function addPhotos() {
  if (state.busy) return;
  const chosen = await pickMedia({
    multiple: true,
    exclude: ids(),
    title: "Add photos to the gallery",
    doneLabel: (n) => (n ? `Add ${n} ${n === 1 ? "photo" : "photos"}` : "Add photos"),
  });
  if (!chosen?.length) return;

  state.busy = true;
  els.add.disabled = true;
  let added = 0;
  const failed = [];

  for (const m of chosen) {
    try {
      await admin.gallery.add(m.id);
      const item = { media_id: m.id, public_url: m.public_url, alt_text: m.alt_text, caption: m.caption };
      state.items.push(item);
      state.savedOrder.push(m.id); // the server adds new photos at the end
      added += 1;
      render();
    } catch (error) {
      failed.push(error.message);
    }
  }

  state.busy = false;
  els.add.disabled = false;
  if (added) toast(`${added} ${added === 1 ? "photo" : "photos"} added to the gallery`);
  if (failed.length) toast(`${failed.length} couldn't be added: ${failed[0]}`, "error");

  // Confirm the real order from the server, unless there are unsaved order changes.
  if (added && !orderChanged()) refresh();
}

els.add.addEventListener("click", addPhotos);

/* ---------------- Remove ---------------- */

async function removePhoto(id, button) {
  if (state.busy) return;
  button.disabled = true;
  try {
    await admin.gallery.remove(id);
    const index = state.items.findIndex((i) => i.media_id === id);
    state.items = state.items.filter((i) => i.media_id !== id);
    state.savedOrder = state.savedOrder.filter((x) => x !== id);
    render();
    toast("Removed from the gallery. It's still in the media library.");
    // Put focus somewhere sensible: the photo that took its place.
    const next = els.grid.querySelectorAll(".sort-grid__item")[Math.min(index, state.items.length - 1)];
    (next?.querySelector("[data-remove]") || els.add).focus();
  } catch (error) {
    button.disabled = false;
    toast(error.message || "Couldn't remove the photo.", "error");
  }
}

/* ---------------- Load ---------------- */

function setFromServer(list) {
  state.items = [...list]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((g) => ({ media_id: g.media_id, public_url: g.public_url, alt_text: g.alt_text, caption: g.caption }));
  state.savedOrder = ids();
}

async function refresh() {
  try {
    setFromServer(await admin.gallery.list());
    render();
  } catch {
    /* keep what's on screen */
  }
}

async function load() {
  const stop = showLoading(els.grid, { lines: 4 });
  try {
    const list = await admin.gallery.list();
    stop();
    setFromServer(list);
    render();
  } catch (error) {
    stop();
    showError(els.grid, error, load);
  }
}

window.addEventListener("beforeunload", (e) => {
  if (orderChanged()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

const user = await requireAdmin();
renderAdminLayout(user);
setAdminTitle("Gallery");
load();
