/**
 * Documents page: published PDFs visitors can download.
 * Location: js/pages/documents.js   (loaded by documents.html)
 *
 * GET /documents returns published documents, newest first, each with a
 * download_url path. The download link is that path joined to the API
 * origin from js/config.js (never an R2 storage address).
 *
 * "View" opens the PDF inside the page (a full-screen viewer). Computers use
 * the browser's own PDF viewer; phones, whose browsers can't show a PDF
 * inside a page, use the built-in reader in js/pdf-reader.js. Nothing is
 * saved to the device: only "Download" saves the file.
 *
 * Clicking Download fetches the file first, so a document withdrawn since
 * the list loaded shows a friendly message instead of a raw 404 page.
 * The link stays a real link, so "open in new tab" and right-click work too.
 */

import { api, formatDate, documentDownloadUrl, fetchDocumentFile, saveDocumentFile } from "../api.js";
import { escapeHtml, renderShell, initShell, showLoading, showEmpty, showError } from "../ui.js";
import { renderPdf, loadPdfJs } from "../pdf-reader.js";

const SHOW_FILTER_FROM = 6; // show the "find a document" box once there are this many

const els = {
  tools: document.querySelector("[data-tools]"),
  filter: document.querySelector("[data-filter]"),
  count: document.querySelector("[data-count]"),
  list: document.querySelector("[data-documents]"),
};

const state = { docs: [] };

/* ---------------- Formatting ---------------- */

function fileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------------- Rendering ---------------- */

function rowHtml(doc) {
  const href = documentDownloadUrl(doc);
  const size = fileSize(doc.file_size);
  const date = doc.created_at ? formatDate(doc.created_at, { dateStyle: "long" }) : "";
  const meta = ["PDF", size, date && `Added ${date}`].filter(Boolean).join(", ");

  return `
    <li class="doc" data-id="${escapeHtml(doc.id)}">
      <h2 class="doc__title">${escapeHtml(doc.title)}</h2>
      <div class="doc__body">
        <span class="doc__icon" aria-hidden="true">PDF</span>
        <div class="doc__text">
          ${doc.description ? `<p class="doc__desc">${escapeHtml(doc.description)}</p>` : ""}
          <p class="doc__meta">${escapeHtml(meta)}</p>
        </div>
      </div>
      <p class="doc__status" role="status" data-status hidden></p>
      ${
        href
          ? `<div class="doc__actions">
               <button type="button" class="button button--quiet doc__view" data-view="${escapeHtml(doc.id)}"
                 aria-label="View ${escapeHtml(doc.title)}">View</button>
               <a class="button doc__download" href="${escapeHtml(href)}" data-download="${escapeHtml(doc.id)}"
                 aria-label="Download ${escapeHtml(doc.title)} (${escapeHtml(meta)})">Download</a>
             </div>`
          : `<span class="doc__unavailable">Not available</span>`
      }
    </li>`;
}

function render() {
  const q = els.filter.value.trim().toLowerCase();
  const total = state.docs.length;
  const docs = q
    ? state.docs.filter((d) => `${d.title} ${d.description || ""}`.toLowerCase().includes(q))
    : state.docs;

  els.tools.hidden = total < SHOW_FILTER_FROM;

  if (!docs.length) {
    els.count.textContent = "";
    els.list.innerHTML = `
      <div class="state state--empty">
        <p>No documents match “${escapeHtml(els.filter.value)}”.</p>
        <button type="button" class="button button--quiet" data-clear>Show all documents</button>
      </div>`;
    return;
  }

  els.count.textContent =
    docs.length === total
      ? `${total} ${total === 1 ? "document" : "documents"}`
      : `${docs.length} of ${total} documents`;
  els.list.innerHTML = `<ul class="doc-list">${docs.map(rowHtml).join("")}</ul>`;
}

/* ---------------- Download ---------------- */

function setStatus(row, text, kind = "") {
  const status = row.querySelector("[data-status]");
  status.textContent = text;
  status.className = `doc__status${kind ? ` doc__status--${kind}` : ""}`;
  status.hidden = !text;
}

/* Files already fetched, so View then Download doesn't fetch twice */
const files = new Map();

/** Fetch a document's PDF with the row's busy state and messages. Returns the file or null. */
async function getFile(doc, row, button, busyLabel) {
  if (files.has(doc.id)) return files.get(doc.id);
  const label = button.textContent;
  button.setAttribute("aria-disabled", "true");
  button.textContent = busyLabel;
  setStatus(row, "");
  const slow = setTimeout(() => setStatus(row, "The server is waking up. This can take up to a minute."), 4000);
  try {
    const result = await fetchDocumentFile(doc, { fallbackName: doc.title });
    if (result === "missing") {
      // Withdrawn or unpublished since the page loaded.
      setStatus(row, "This document is no longer available. It may have been replaced or withdrawn.", "error");
      row.querySelector(".doc__actions")?.remove();
      state.docs = state.docs.filter((d) => d.id !== doc.id);
      return null;
    }
    if (result === "fallback") return "fallback";
    setStatus(row, "");
    files.set(doc.id, result);
    return result;
  } catch (error) {
    setStatus(row, error.message || "The document couldn't be loaded. Please try again.", "error");
    return null;
  } finally {
    clearTimeout(slow);
    if (button.isConnected) {
      button.removeAttribute("aria-disabled");
      button.textContent = label;
    }
  }
}

/* ---------------- Viewer ---------------- */

// Computers can show a PDF inside the page with the browser's own viewer.
// Phones and tablets (Android, iPhone, iPad) can't, so they get the built-in
// reader instead, which draws the pages on the page and saves nothing.
const isPhoneOrTablet =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS
const useBrowserViewer = !isPhoneOrTablet && (navigator.pdfViewerEnabled ?? true);

const ZOOMS = [1, 1.5, 2];

let viewer = null;
let viewerUrl = "";
let viewerDoc = null;
let viewerReturn = null;
let reader = null;
let zoomIndex = 0;

function buildViewer() {
  viewer = document.createElement("dialog");
  viewer.className = "pdf-viewer";
  viewer.setAttribute("aria-labelledby", "pdf-viewer-title");
  viewer.innerHTML = `
    <div class="pdf-viewer__bar">
      <p class="pdf-viewer__title" id="pdf-viewer-title"></p>
      <div class="pdf-viewer__actions">
        <div class="pdf-viewer__zoom" data-zoom-controls hidden>
          <button type="button" class="pdf-viewer__zoom-btn" data-zoom-out aria-label="Zoom out">−</button>
          <span class="pdf-viewer__zoom-level" data-zoom-level aria-live="polite">100%</span>
          <button type="button" class="pdf-viewer__zoom-btn" data-zoom-in aria-label="Zoom in">+</button>
        </div>
        <button type="button" class="button pdf-viewer__download" data-viewer-download>Download</button>
        <button type="button" class="button button--quiet pdf-viewer__close" data-viewer-close aria-label="Close">
          <span aria-hidden="true">✕</span><span class="pdf-viewer__close-text" aria-hidden="true"> Close</span>
        </button>
      </div>
    </div>
    <iframe class="pdf-viewer__frame" title="Document preview" hidden></iframe>
    <div class="pdf-viewer__scroll" data-pdf-scroll hidden>
      <p class="pdf-viewer__status" data-pdf-status role="status"></p>
      <div class="pdf-viewer__pages" data-pdf-pages></div>
    </div>`;
  document.body.appendChild(viewer);

  viewer.addEventListener("click", (e) => {
    if (e.target.closest("[data-viewer-close]")) viewer.close();
    if (e.target.closest("[data-viewer-download]") && viewerDoc && files.has(viewerDoc.id)) {
      saveDocumentFile(files.get(viewerDoc.id));
    }
    const zoomIn = e.target.closest("[data-zoom-in]");
    const zoomOut = e.target.closest("[data-zoom-out]");
    if ((zoomIn || zoomOut) && reader) {
      zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, zoomIndex + (zoomIn ? 1 : -1)));
      applyZoom();
    }
  });
  viewer.addEventListener("close", () => {
    viewer.querySelector("iframe").src = "about:blank";
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    viewerUrl = "";
    reader?.destroy();
    reader = null;
    viewerReturn?.focus();
  });
  return viewer;
}

function applyZoom() {
  const box = viewer;
  box.querySelector("[data-zoom-level]").textContent = `${Math.round(ZOOMS[zoomIndex] * 100)}%`;
  box.querySelector("[data-zoom-out]").disabled = zoomIndex === 0;
  box.querySelector("[data-zoom-in]").disabled = zoomIndex === ZOOMS.length - 1;
  reader?.setZoom(ZOOMS[zoomIndex]);
}

function openViewer(doc) {
  const dialog = viewer || buildViewer();
  viewerDoc = doc;
  dialog.querySelector(".pdf-viewer__title").textContent = doc.title;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("[data-viewer-close]").focus();
  return dialog;
}

/** Computers: the browser's own PDF viewer, in a frame. */
function showInBrowserViewer(doc, file) {
  const dialog = openViewer(doc);
  dialog.querySelector("[data-pdf-scroll]").hidden = true;
  dialog.querySelector("[data-zoom-controls]").hidden = true;
  const frame = dialog.querySelector("iframe");
  frame.hidden = false;
  viewerUrl = URL.createObjectURL(file.blob);
  frame.title = `Preview of ${doc.title}`;
  frame.src = viewerUrl;
}

/** Phones and tablets: the built-in reader. */
async function showInReader(doc, file) {
  const dialog = openViewer(doc);
  dialog.querySelector("iframe").hidden = true;
  const scroll = dialog.querySelector("[data-pdf-scroll]");
  const pages = dialog.querySelector("[data-pdf-pages]");
  const status = dialog.querySelector("[data-pdf-status]");
  const zoom = dialog.querySelector("[data-zoom-controls]");
  scroll.hidden = false;
  scroll.scrollTop = 0;
  zoom.hidden = true;
  pages.innerHTML = "";
  pages.style.removeProperty("--pdf-zoom");
  status.hidden = false;
  status.className = "pdf-viewer__status";
  status.textContent = "Opening the document…";

  try {
    reader?.destroy();
    reader = await renderPdf(pages, file.blob);
    if (!dialog.open || viewerDoc !== doc) {
      reader.destroy();
      reader = null;
      return;
    }
    status.hidden = true;
    zoomIndex = 0;
    zoom.hidden = false;
    applyZoom();
    pages.setAttribute("aria-label", `${doc.title}, ${reader.pages} ${reader.pages === 1 ? "page" : "pages"}`);
  } catch {
    status.className = "pdf-viewer__status pdf-viewer__status--error";
    status.textContent = "This document couldn't be shown here. Tap Download to save it and open it on your phone.";
  }
}

async function viewDocument(doc, row, button) {
  viewerReturn = button;
  if (!useBrowserViewer) loadPdfJs().catch(() => {}); // start loading the reader while the file downloads
  const file = await getFile(doc, row, button, "Opening…");
  if (!file) return;
  if (file === "fallback") {
    // The browser couldn't fetch it here; open the file's address directly.
    window.open(documentDownloadUrl(doc), "_blank", "noopener");
    return;
  }
  if (useBrowserViewer) showInBrowserViewer(doc, file);
  else showInReader(doc, file);
}

/* ---------------- Clicks ---------------- */

els.list.addEventListener("click", async (e) => {
  if (e.target.closest("[data-clear]")) {
    els.filter.value = "";
    render();
    els.filter.focus();
    return;
  }

  const viewBtn = e.target.closest("[data-view]");
  if (viewBtn) {
    const doc = state.docs.find((d) => d.id === viewBtn.dataset.view);
    if (doc && viewBtn.getAttribute("aria-disabled") !== "true") viewDocument(doc, viewBtn.closest(".doc"), viewBtn);
    return;
  }

  const link = e.target.closest("[data-download]");
  // Let ctrl/cmd-click and middle-click open the link normally.
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();

  const row = link.closest(".doc");
  const doc = state.docs.find((d) => d.id === link.dataset.download);
  if (!doc || link.getAttribute("aria-disabled") === "true") return;

  const file = await getFile(doc, row, link, "Preparing…");
  if (!file) return;
  if (file === "fallback") {
    window.location.href = link.href; // let the browser download it directly
    return;
  }
  saveDocumentFile(file);
  setStatus(row, "Downloaded. Check your downloads folder.", "ok");
  setTimeout(() => setStatus(row, ""), 5000);
});

els.filter.addEventListener("input", render);

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.list, { lines: 4 });
  els.count.textContent = "";
  try {
    const docs = await api.listDocuments();
    stop();
    // Newest first, as the API promises; sort anyway in case.
    state.docs = [...(docs || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (!state.docs.length) {
      els.tools.hidden = true;
      showEmpty(els.list, "No documents have been published yet. Please check back soon.", {
        href: "/contact.html",
        label: "Contact us for a document",
      });
      return;
    }
    render();
  } catch (error) {
    stop();
    showError(els.list, error, load);
  }
}

renderShell();
initShell().then((site) => {
  if (site?.community_name) document.title = `Documents | ${site.community_name}`;
});
load();
