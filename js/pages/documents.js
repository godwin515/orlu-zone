/**
 * Documents page: published PDFs visitors can download.
 * Location: js/pages/documents.js   (loaded by documents.html)
 *
 * GET /documents returns published documents, newest first, each with a
 * download_url path. The download link is that path joined to the API
 * origin from js/config.js (never an R2 storage address).
 *
 * Clicking Download fetches the file first, so a document withdrawn since
 * the list loaded shows a friendly message instead of a raw 404 page.
 * The link stays a real link, so "open in new tab" and right-click work too.
 */

import { api, formatDate, documentDownloadUrl, downloadDocument } from "../api.js";
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
      <span class="doc__icon" aria-hidden="true">PDF</span>
      <div class="doc__body">
        <h2 class="doc__title">${escapeHtml(doc.title)}</h2>
        ${doc.description ? `<p class="doc__desc">${escapeHtml(doc.description)}</p>` : ""}
        <p class="doc__meta">${escapeHtml(meta)}</p>
        <p class="doc__status" role="status" data-status hidden></p>
      </div>
      ${
        href
          ? `<a class="button doc__download" href="${escapeHtml(href)}" data-download="${escapeHtml(doc.id)}"
               aria-label="Download ${escapeHtml(doc.title)} (${escapeHtml(meta)})">Download</a>`
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

els.list.addEventListener("click", async (e) => {
  if (e.target.closest("[data-clear]")) {
    els.filter.value = "";
    render();
    els.filter.focus();
    return;
  }

  const link = e.target.closest("[data-download]");
  // Let ctrl/cmd-click and middle-click open the link normally.
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();

  const row = link.closest(".doc");
  const doc = state.docs.find((d) => d.id === link.dataset.download);
  if (!doc || link.getAttribute("aria-disabled") === "true") return;

  link.setAttribute("aria-disabled", "true");
  link.textContent = "Preparing…";
  const slow = setTimeout(() => setStatus(row, "The server is waking up. This can take up to a minute."), 4000);

  try {
    const result = await downloadDocument(doc, { fallbackName: doc.title });
    if (result === "missing") {
      // Withdrawn or unpublished since the page loaded.
      setStatus(row, "This document is no longer available. It may have been replaced or withdrawn.", "error");
      link.remove();
      state.docs = state.docs.filter((d) => d.id !== doc.id);
      return;
    }
    if (result === "fallback") {
      window.location.href = link.href; // let the browser download it directly
      return;
    }
    setStatus(row, "Downloaded. Check your downloads folder.", "ok");
    setTimeout(() => setStatus(row, ""), 5000);
  } catch (error) {
    setStatus(row, error.message || "The download failed. Please try again.", "error");
  } finally {
    clearTimeout(slow);
    if (link.isConnected) {
      link.removeAttribute("aria-disabled");
      link.textContent = "Download";
    }
  }
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
