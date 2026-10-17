/**
 * Admin Documents: PDFs for the public Documents page.
 * Location: js/admin/documents.js   (loaded by admin/documents.html)
 *
 * GET   /admin/documents                    every document (draft, published, withdrawn), newest first
 * POST  /admin/documents                    upload (multipart: file, title, description) -> new draft (201)
 * PATCH /admin/documents/{id}               edit title / description (only what changed)
 * POST  /admin/documents/{id}/publish       show it on the website (200)
 * POST  /admin/documents/{id}/withdraw      take it off the website; it stays stored (200)
 *
 * There is no delete, and the PDF of an existing document can't be replaced:
 * to update a file, upload the new version and withdraw the old one.
 * After every change the list is reloaded from the server.
 */

import { admin, ApiError, formatDate, documentDownloadUrl } from "../api.js";
import { escapeHtml, showLoading, showError } from "../ui.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import { confirmDialog, toast, statusTag } from "./admin-ui.js";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MiB, the API's limit
const TITLE_MAX = 255;

const form = document.querySelector("[data-doc-form]");
const f = (name) => form.elements.namedItem(name);

const els = {
  count: document.querySelector("[data-count]"),
  tabs: document.querySelector("[data-status-tabs]"),
  list: document.querySelector("[data-documents]"),
  panel: document.querySelector("[data-form-panel]"),
  formTitle: document.querySelector("[data-form-title]"),
  formError: document.querySelector("[data-form-error]"),
  dropzone: document.querySelector("[data-dropzone]"),
  fileInput: document.querySelector("[data-file-input]"),
  chosen: document.querySelector("[data-file-chosen]"),
  stored: document.querySelector("[data-file-stored]"),
  uploadOnly: document.querySelectorAll("[data-upload-only]"),
  progress: document.querySelector("[data-progress]"),
  progressBar: document.querySelector("[data-progress-bar]"),
  progressText: document.querySelector("[data-progress-text]"),
  save: document.querySelector("[data-save]"),
  cancel: document.querySelector("[data-cancel-edit]"),
  docState: document.querySelector("[data-doc-state]"),
};

const STATUSES = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "published", label: "Published" },
  { key: "withdrawn", label: "Withdrawn" },
];

const state = {
  docs: [],
  filter: "all",
  editingId: null,
  file: null, // the PDF chosen for upload
  titleTouched: false, // stop auto-filling the title once the admin types one
  formDirty: false,
  busy: false, // a save or upload is running
  acting: new Set(), // ids with a publish/withdraw in flight
};

const editing = () => state.docs.find((d) => d.id === state.editingId) || null;

/* ---------------- Helpers ---------------- */

function fileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortDate(iso) {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return "";
  return formatDate(iso, { dateStyle: "medium" });
}

/** "membership_form-2026 v2.pdf" -> "Membership form 2026 v2" */
function titleFromFilename(name) {
  const base = String(name || "")
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, TITLE_MAX);
}

function setFieldError(name, message) {
  const error = form.querySelector(`[data-error-for="${name}"]`);
  const input = name === "file" ? els.fileInput : f(name);
  if (!error || !input) return false;
  const errId = `${name}-error`;
  const described = (input.getAttribute("aria-describedby") || "").split(" ").filter((d) => d && d !== errId);
  if (message) {
    error.id = errId;
    error.textContent = message;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", [...described, errId].join(" "));
    if (name === "file") els.dropzone.classList.add("is-invalid");
  } else {
    error.hidden = true;
    input.removeAttribute("aria-invalid");
    if (described.length) input.setAttribute("aria-describedby", described.join(" "));
    else input.removeAttribute("aria-describedby");
    if (name === "file") els.dropzone.classList.remove("is-invalid");
  }
  return true;
}

function clearErrors() {
  ["file", "title", "description"].forEach((n) => setFieldError(n, ""));
  els.formError.hidden = true;
}

function showFormError(message) {
  els.formError.textContent = message;
  els.formError.hidden = false;
}

/** Friendly message for each status the contract lists. Form input is never cleared. */
function explain(error, { action = "save" } = {}) {
  if (!(error instanceof ApiError)) return "Something went wrong. Please try again.";
  switch (error.status) {
    case 0:
      return error.message;
    case 400:
      return error.message || "That file isn't a valid PDF.";
    case 403:
      return "Your account isn't allowed to manage documents.";
    case 404:
      return "This document no longer exists. The list has been refreshed.";
    case 413:
      return "That file is too large for the server. PDFs must be 20 MB or smaller.";
    case 503:
      return `Document storage is unavailable right now, so we couldn't ${action}. Nothing you typed has been lost. Please try again in a few minutes.`;
    default:
      return error.message;
  }
}

/** Put 422 field messages next to their fields. Returns true if any landed. */
function showFieldErrors(error) {
  if (!(error instanceof ApiError) || error.status !== 422) return false;
  let placed = false;
  for (const [field, msg] of Object.entries(error.fieldErrors)) {
    if (setFieldError(field, msg)) placed = true;
  }
  return placed;
}

/* ---------------- List ---------------- */

function counts() {
  const c = { all: state.docs.length, draft: 0, published: 0, withdrawn: 0 };
  for (const d of state.docs) if (d.status in c) c[d.status] += 1;
  return c;
}

function renderTabs() {
  const c = counts();
  els.tabs.hidden = state.docs.length === 0;
  els.tabs.innerHTML = `
    <ul class="status-tabs__list">
      ${STATUSES.map(
        (s) => `
        <li><button type="button" class="status-tabs__tab" data-filter="${s.key}"
          ${s.key === state.filter ? 'aria-current="true"' : ""}>
          ${s.label} <span class="status-tabs__count">${c[s.key]}</span>
        </button></li>`,
      ).join("")}
    </ul>`;
}

function actionsHtml(doc) {
  const busy = state.acting.has(doc.id);
  const dis = busy ? "disabled" : "";
  const open =
    doc.status === "published"
      ? `<a class="link-button" href="${escapeHtml(documentDownloadUrl(doc) || "#")}" target="_blank" rel="noopener"
           aria-label="Open ${escapeHtml(doc.title)} (opens the public download)">Open</a>`
      : "";
  const toggle =
    doc.status === "published"
      ? `<button type="button" class="link-button link-button--danger" data-withdraw="${escapeHtml(doc.id)}" ${dis}>Withdraw</button>`
      : `<button type="button" class="link-button" data-publish="${escapeHtml(doc.id)}" ${dis}>${
          doc.status === "withdrawn" ? "Publish again" : "Publish"
        }</button>`;
  return `
    <button type="button" class="link-button" data-edit="${escapeHtml(doc.id)}"
      aria-label="Edit ${escapeHtml(doc.title)}">Edit</button>
    ${toggle}
    ${open}`;
}

function rowHtml(doc) {
  return `
    <tr data-id="${escapeHtml(doc.id)}" class="${doc.id === state.editingId ? "is-editing" : ""}${
      doc.status === "withdrawn" ? " is-withdrawn" : ""
    }">
      <td class="cell-title" data-label="Document">
        <span class="doc-cell">
          <span class="doc-mini" aria-hidden="true">PDF</span>
          <span>
            <span class="cell-title__text">${escapeHtml(doc.title)}</span>
            <span class="cell-sub">${escapeHtml(doc.original_filename || "")}</span>
            ${doc.description ? `<span class="cell-desc">${escapeHtml(doc.description)}</span>` : ""}
          </span>
        </span>
      </td>
      <td class="cell-date" data-label="Size">${escapeHtml(fileSize(doc.file_size))}</td>
      <td class="cell-date" data-label="Added">${escapeHtml(shortDate(doc.created_at))}</td>
      <td data-label="Status">${statusTag(doc.status)}</td>
      <td class="cell-actions" data-label="Actions">${actionsHtml(doc)}</td>
    </tr>`;
}

function renderList() {
  const c = counts();
  els.count.textContent = c.all
    ? `${c.all} ${c.all === 1 ? "document" : "documents"}, ${c.published} on the website`
    : "";
  renderTabs();

  if (!c.all) {
    els.list.innerHTML = `
      <div class="empty-block">
        <p>No documents yet. Upload the first PDF with the form. It starts as a draft, so you can check it before publishing.</p>
      </div>`;
    return;
  }

  const shown = state.filter === "all" ? state.docs : state.docs.filter((d) => d.status === state.filter);
  if (!shown.length) {
    const label = STATUSES.find((s) => s.key === state.filter)?.label.toLowerCase();
    els.list.innerHTML = `
      <div class="empty-block">
        <p>No ${escapeHtml(label)} documents.</p>
        <button type="button" class="button button--quiet" data-filter="all">Show all documents</button>
      </div>`;
    return;
  }

  els.list.innerHTML = `
    <div class="table-wrap">
      <table class="data-table doc-table">
        <thead>
          <tr><th scope="col">Document</th><th scope="col">Size</th><th scope="col">Added</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr>
        </thead>
        <tbody>${shown.map(rowHtml).join("")}</tbody>
      </table>
    </div>`;
}

/* ---------------- Form: modes ---------------- */

function renderChosen() {
  const file = state.file;
  els.chosen.hidden = !file;
  els.dropzone.hidden = Boolean(file);
  if (!file) {
    els.chosen.innerHTML = "";
    return;
  }
  els.chosen.innerHTML = `
    <span class="doc-mini" aria-hidden="true">PDF</span>
    <span class="file-chosen__text">
      <span class="file-chosen__name">${escapeHtml(file.name)}</span>
      <span class="cell-sub">${escapeHtml(fileSize(file.size))}</span>
    </span>
    <button type="button" class="link-button" data-change-file>Change file</button>`;
}

function renderDocState() {
  const doc = editing();
  els.docState.hidden = !doc;
  if (!doc) return;
  const busy = state.acting.has(doc.id) ? "disabled" : "";
  const text = {
    draft: "This document is a draft. Visitors can't see it yet.",
    published: "This document is on the website and can be downloaded.",
    withdrawn: "This document has been withdrawn. It's kept here but visitors can't see or download it.",
  }[doc.status] || "";
  const button =
    doc.status === "published"
      ? `<button type="button" class="button button--danger-quiet" data-withdraw="${escapeHtml(doc.id)}" ${busy}>Withdraw from website</button>`
      : `<button type="button" class="button button--gold" data-publish="${escapeHtml(doc.id)}" ${busy}>${
          doc.status === "withdrawn" ? "Publish again" : "Publish to website"
        }</button>`;
  els.docState.innerHTML = `
    <p class="doc-state__line">${statusTag(doc.status)} <span>${escapeHtml(text)}</span></p>
    ${button}`;
}

function renderStored() {
  const doc = editing();
  els.stored.hidden = !doc;
  if (!doc) return;
  const updated =
    doc.updated_at && doc.updated_at !== doc.created_at ? `, last changed ${shortDate(doc.updated_at)}` : "";
  els.stored.innerHTML = `
    <span class="doc-mini" aria-hidden="true">PDF</span>
    <span class="file-chosen__text">
      <span class="file-chosen__name">${escapeHtml(doc.original_filename || "document.pdf")}</span>
      <span class="cell-sub">${escapeHtml(`${fileSize(doc.file_size)}, uploaded ${shortDate(doc.created_at)}${updated}`)}</span>
      <span class="cell-sub">The file itself can't be replaced. To update it, upload the new version and withdraw this one.</span>
    </span>`;
}

function setMode() {
  const isEdit = Boolean(state.editingId);
  els.uploadOnly.forEach((el) => (el.hidden = isEdit));
  els.formTitle.textContent = isEdit ? "Edit document" : "Upload a document";
  els.save.textContent = isEdit ? "Save changes" : "Upload document";
  els.cancel.hidden = !isEdit;
  els.panel.classList.toggle("is-editing", isEdit);
  renderStored();
  renderDocState();
}

function resetForm() {
  form.reset();
  clearErrors();
  state.editingId = null;
  state.file = null;
  state.titleTouched = false;
  state.formDirty = false;
  els.fileInput.value = "";
  els.progress.hidden = true;
  renderChosen();
  setMode();
  renderList();
}

async function confirmDiscard() {
  if (!state.formDirty) return true;
  return confirmDialog({
    title: "Discard your changes?",
    message: "What you've typed in the form hasn't been saved.",
    confirmLabel: "Discard",
    danger: true,
  });
}

async function startEdit(id) {
  if (state.busy) return;
  if (id === state.editingId) {
    f("title").focus();
    return;
  }
  if (!(await confirmDiscard())) return;
  const doc = state.docs.find((d) => d.id === id);
  if (!doc) return;
  resetForm();
  state.editingId = id;
  f("title").value = doc.title || "";
  f("description").value = doc.description || "";
  setMode();
  renderList();
  if (window.matchMedia("(max-width: 1000px)").matches) {
    els.panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  f("title").focus({ preventScroll: true });
}

/* ---------------- Choosing a file ---------------- */

/** Reads the first bytes: real PDFs start with "%PDF-" (allowed anywhere in the first 1 KB). */
async function looksLikePdf(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    const text = String.fromCharCode(...head);
    return text.includes("%PDF-");
  } catch {
    return true; // can't read it here; let the server decide
  }
}

async function chooseFile(file) {
  if (!file) return;
  setFieldError("file", "");
  els.formError.hidden = true;

  const isPdfName = /\.pdf$/i.test(file.name);
  const isPdfType = file.type === "application/pdf";
  if (!isPdfName && !isPdfType) {
    setFieldError("file", `“${file.name}” isn't a PDF. Save or export it as a PDF first.`);
    return;
  }
  if (file.size === 0) {
    setFieldError("file", "That file is empty.");
    return;
  }
  if (file.size > MAX_BYTES) {
    setFieldError("file", `That file is ${fileSize(file.size)}. PDFs must be 20 MB or smaller.`);
    return;
  }
  if (!(await looksLikePdf(file))) {
    setFieldError("file", `“${file.name}” doesn't look like a real PDF. Try exporting it again as a PDF.`);
    return;
  }

  state.file = file;
  state.formDirty = true;
  if (!state.titleTouched || !f("title").value.trim()) {
    f("title").value = titleFromFilename(file.name);
    state.titleTouched = false;
    setFieldError("title", "");
  }
  renderChosen();
  f("title").focus();
  f("title").select();
}

els.fileInput.addEventListener("change", () => chooseFile(els.fileInput.files?.[0]));

els.dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.dropzone.classList.add("is-over");
});
els.dropzone.addEventListener("dragleave", () => els.dropzone.classList.remove("is-over"));
els.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  els.dropzone.classList.remove("is-over");
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length > 1) toast("One PDF at a time. Using the first file.", "error");
  chooseFile(files[0]);
});

// A PDF dropped anywhere else on the page shouldn't open in the browser and lose the form.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  if (!els.dropzone.contains(e.target)) e.preventDefault();
});

els.chosen.addEventListener("click", (e) => {
  if (!e.target.closest("[data-change-file]") || state.busy) return;
  state.file = null;
  els.fileInput.value = "";
  renderChosen();
  els.fileInput.click();
});

/* ---------------- Saving ---------------- */

function validate() {
  clearErrors();
  let firstBad = null;
  const title = f("title").value.trim();
  if (!state.editingId && !state.file) {
    setFieldError("file", "Choose a PDF to upload.");
    firstBad ||= els.fileInput;
  }
  if (!title) {
    setFieldError("title", "Give the document a title.");
    firstBad ||= f("title");
  } else if (title.length > TITLE_MAX) {
    setFieldError("title", `Keep the title under ${TITLE_MAX} characters.`);
    firstBad ||= f("title");
  }
  if (firstBad) {
    if (firstBad === els.fileInput) els.dropzone.scrollIntoView({ block: "nearest" });
    else firstBad.focus();
  }
  return !firstBad;
}

function setBusy(busy, label) {
  state.busy = busy;
  els.save.disabled = busy;
  els.cancel.disabled = busy;
  form.querySelectorAll("input, textarea").forEach((el) => (el.readOnly = busy));
  els.fileInput.disabled = busy;
  if (label) els.save.textContent = label;
  if (!busy) els.save.textContent = state.editingId ? "Save changes" : "Upload document";
}

function showProgress(fraction) {
  els.progress.hidden = false;
  const pct = Math.round(fraction * 100);
  els.progressBar.style.width = `${pct}%`;
  els.progressText.textContent =
    pct < 100 ? `Uploading… ${pct}%` : "Upload sent. Waiting for the server to check the PDF…";
}

async function upload() {
  const title = f("title").value.trim();
  const description = f("description").value.trim();
  const publishNow = f("publish_now").checked;

  setBusy(true, "Uploading…");
  showProgress(0);
  const slow = setTimeout(() => {
    if (els.progressBar.style.width === "0%") {
      els.progressText.textContent = "Uploading… The server may be waking up, which can take up to a minute.";
    }
  }, 5000);

  let doc;
  try {
    doc = await admin.documents.upload(state.file, { title, description, onProgress: showProgress });
  } catch (error) {
    clearTimeout(slow);
    els.progress.hidden = true;
    setBusy(false);
    if (error instanceof ApiError && error.status === 400) {
      setFieldError("file", explain(error));
      showFormError("The server didn't accept this file. Nothing was uploaded.");
    } else if (!showFieldErrors(error)) {
      showFormError(explain(error, { action: "upload the document" }));
    }
    return;
  }
  clearTimeout(slow);

  if (publishNow && doc?.id) {
    els.progressText.textContent = "Uploaded. Publishing…";
    try {
      doc = await admin.documents.publish(doc.id);
      toast(`“${title}” uploaded and published`);
    } catch (error) {
      toast(`“${title}” was uploaded as a draft, but publishing failed: ${explain(error, { action: "publish it" })}`, "error");
    }
  } else {
    toast(`“${title}” uploaded as a draft`);
  }

  setBusy(false);
  if (doc?.id) mergeDoc(doc);
  resetForm();
  refresh();
}

async function saveEdit() {
  const doc = editing();
  if (!doc) return resetForm();
  const title = f("title").value.trim();
  const description = f("description").value.trim();

  const changes = {};
  if (title !== (doc.title || "")) changes.title = title;
  if (description !== (doc.description || "")) changes.description = description || null;
  if (!Object.keys(changes).length) {
    state.formDirty = false;
    toast("No changes to save");
    return;
  }

  setBusy(true, "Saving…");
  try {
    const updated = await admin.documents.update(doc.id, changes);
    setBusy(false);
    state.formDirty = false;
    if (updated?.id) mergeDoc(updated);
    toast("Document updated");
    resetForm();
    refresh();
  } catch (error) {
    setBusy(false);
    if (error instanceof ApiError && error.status === 404) {
      toast(explain(error), "error");
      state.formDirty = false;
      refresh();
      return;
    }
    if (!showFieldErrors(error)) showFormError(explain(error, { action: "save your changes" }));
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.busy || !validate()) return;
  if (state.editingId) saveEdit();
  else upload();
});

form.addEventListener("input", (e) => {
  if (e.target === els.fileInput) return;
  state.formDirty = true;
  if (e.target.name === "title") {
    state.titleTouched = true;
    if (e.target.value.trim()) setFieldError("title", "");
  }
});

els.cancel.addEventListener("click", async () => {
  if (await confirmDiscard()) resetForm();
});

/* ---------------- Publish / withdraw ---------------- */

function mergeDoc(doc) {
  const i = state.docs.findIndex((d) => d.id === doc.id);
  if (i >= 0) state.docs[i] = { ...state.docs[i], ...doc };
  else state.docs.unshift(doc);
}

async function changeStatus(id, action) {
  const doc = state.docs.find((d) => d.id === id);
  if (!doc || state.acting.has(id)) return;

  if (action === "withdraw") {
    const ok = await confirmDialog({
      title: `Withdraw “${doc.title}”?`,
      message:
        "It will disappear from the website's Documents page and its download link will stop working. It stays stored here, and you can publish it again later.",
      confirmLabel: "Withdraw",
      danger: true,
    });
    if (!ok) return;
  }

  state.acting.add(id);
  renderList();
  renderDocState();
  try {
    const updated = await (action === "publish" ? admin.documents.publish(id) : admin.documents.withdraw(id));
    mergeDoc(updated?.id ? updated : { ...doc, status: action === "publish" ? "published" : "withdrawn" });
    toast(action === "publish" ? `“${doc.title}” is now on the website` : `“${doc.title}” withdrawn`);
  } catch (error) {
    toast(explain(error, { action: action === "publish" ? "publish it" : "withdraw it" }), "error");
  } finally {
    state.acting.delete(id);
    renderList();
    renderDocState();
    refresh();
  }
}

/* ---------------- Clicks ---------------- */

function onClick(e) {
  const filter = e.target.closest("[data-filter]");
  if (filter) {
    state.filter = filter.dataset.filter;
    renderList();
    els.tabs.querySelector(`[data-filter="${state.filter}"]`)?.focus();
    return;
  }
  const edit = e.target.closest("[data-edit]");
  if (edit) return startEdit(edit.dataset.edit);
  const pub = e.target.closest("[data-publish]");
  if (pub) return changeStatus(pub.dataset.publish, "publish");
  const wd = e.target.closest("[data-withdraw]");
  if (wd) return changeStatus(wd.dataset.withdraw, "withdraw");
}

els.list.addEventListener("click", onClick);
els.tabs.addEventListener("click", onClick);
els.docState.addEventListener("click", onClick);

window.addEventListener("beforeunload", (e) => {
  if (state.formDirty || state.busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ---------------- Load ---------------- */

function setFromServer(list) {
  state.docs = [...(list || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/** Reload after a change. Keeps what's on screen if it fails. */
async function refresh() {
  try {
    setFromServer(await admin.documents.list());
    if (state.editingId && !editing()) {
      state.formDirty = false;
      resetForm();
      return;
    }
    renderList();
    renderStored();
    renderDocState();
  } catch {
    /* keep what's on screen */
  }
}

async function load() {
  const stop = showLoading(els.list, { lines: 5 });
  try {
    setFromServer(await admin.documents.list());
    stop();
    renderList();
  } catch (error) {
    stop();
    if (error instanceof ApiError && error.status === 403) {
      els.list.innerHTML = `<p class="notice notice--error">${escapeHtml(explain(error))}</p>`;
      return;
    }
    showError(els.list, error, load);
  }
}

const user = await requireAdmin();
renderAdminLayout(user);
setAdminTitle("Documents");
setMode();
load();
