/**
 * Documents page: published PDFs visitors can download.
 * Location: js/pages/documents.js   (loaded by documents.html)
 *
 * GET /documents returns published documents, newest first, each with a
 * download_url path. The download link is that path joined to the API
 * origin from js/config.js (never an R2 storage address).
 *
 * "View" opens the PDF inside the page (a full-screen viewer); on phones,
 * whose browsers can't show a PDF inside a page, it opens in a new tab.
 *
 * Clicking Download fetches the file first, so a document withdrawn since
 * the list loaded shows a friendly message instead of a raw 404 page.
 * The link stays a real link, so "open in new tab" and right-click work too.
 */

import { api, formatDate, documentDownloadUrl, fetchDocumentFile, saveDocumentFile } from "../api.js";
import { escapeHtml, renderShell, initShell, showLoading, showEmpty, showError } from "../ui.js";

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

// Desktop browsers can show a PDF inside the page; most phone browsers can't.
// iPhones/iPads show a PDF in a new tab. Android saves it and offers to open it
// in a PDF app, so there "View" saves the file and says so.
const isAndroid = /Android/i.test(navigator.userAgent);
const canShowInline =
  !isAndroid && (navigator.pdfViewerEnabled ?? !/iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));

let viewer = null;
let viewerUrl = "";
let viewerDoc = null;
let viewerReturn = null;

function buildViewer() {
  viewer = document.createElement("dialog");
  viewer.className = "pdf-viewer";
  viewer.setAttribute("aria-labelledby", "pdf-viewer-title");
  viewer.innerHTML = `
    <div class="pdf-viewer__bar">
      <p class="pdf-viewer__title" id="pdf-viewer-title"></p>
      <div class="pdf-viewer__actions">
        <button type="button" class="button pdf-viewer__download" data-viewer-download>Download</button>
        <button type="button" class="button button--quiet pdf-viewer__close" data-viewer-close>
          <span aria-hidden="true">✕</span> Close
        </button>
      </div>
    </div>
    <iframe class="pdf-viewer__frame" title="Document preview"></iframe>`;
  document.body.appendChild(viewer);
  viewer.addEventListener("click", (e) => {
    if (e.target.closest("[data-viewer-close]")) viewer.close();
    if (e.target.closest("[data-viewer-download]") && viewerDoc && files.has(viewerDoc.id)) {
      saveDocumentFile(files.get(viewerDoc.id));
    }
  });
  viewer.addEventListener("close", () => {
    viewer.querySelector("iframe").src = "about:blank";
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    viewerUrl = "";
    viewerReturn?.focus();
  });
  return viewer;
}

function showInViewer(doc, file) {
  const dialog = viewer || buildViewer();
  viewerDoc = doc;
  viewerUrl = URL.createObjectURL(file.blob);
  dialog.querySelector(".pdf-viewer__title").textContent = doc.title;
  dialog.querySelector("iframe").title = `Preview of ${doc.title}`;
  dialog.querySelector("iframe").src = viewerUrl;
  dialog.showModal();
  dialog.querySelector("[data-viewer-close]").focus();
}

async function viewDocument(doc, row, button) {
  viewerReturn = button;
  // Phones: open the browser's own PDF viewer in a new tab. The tab is opened
  // now (during the tap) so pop-up blockers allow it, then filled in.
  const tab = canShowInline || isAndroid ? null : window.open("", "_blank");
  const file = await getFile(doc, row, button, "Opening…");
  if (!file) {
    tab?.close();
    return;
  }
  if (file === "fallback") {
    // The browser couldn't fetch it here; open the file's address directly.
    const href = documentDownloadUrl(doc);
    if (tab) tab.location.href = href;
    else window.open(href, "_blank", "noopener");
    return;
  }
  if (isAndroid) {
    saveDocumentFile(file);
    setStatus(row, "Saved to your phone. Tap the download notification to open it.", "ok");
    return;
  }
  if (tab) {
    tab.location.href = URL.createObjectURL(file.blob);
    return;
  }
  showInViewer(doc, file);
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
