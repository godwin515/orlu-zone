/**
 * Admin pages: edit the About and Contact page text.
 * Location: js/admin/pages.js   (loaded by admin/pages.html)
 *
 * GET   /admin/pages/{slug}    load
 * PATCH /admin/pages/{slug}    save { title, content }  (both required)
 *
 * The API has no list of pages and can't create or delete them, so the
 * two pages the website uses are listed here. If one hasn't been created
 * in the backend yet, the page says so.
 */

import { SITE_BASE } from "../config.js";
import { admin, ApiError } from "../api.js";
import { urls, showLoading, showError } from "../ui.js";
import { renderContent, enhanceContent } from "../content.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import { toast, confirmDialog } from "./admin-ui.js";

const PAGES = [
  {
    slug: "about",
    label: "About",
    url: urls.about(),
    hint: "Who the community is, what it does and how it's organised. Leave a blank line between paragraphs. Markdown works: ## Heading, **bold**, - list item.",
  },
  {
    slug: "contact",
    label: "Contact",
    url: urls.contact(),
    hint: "Opening hours and how to get in touch. The phone, email, WhatsApp and address come from Site settings and show beside this text, so you don't need to repeat them.",
  },
];

const form = document.querySelector("[data-page-form]");
const f = (name) => form.elements.namedItem(name);

const els = {
  tabs: document.querySelector("[data-page-tabs]"),
  view: document.querySelector("[data-view-page]"),
  loadState: document.querySelector("[data-load-state]"),
  notice: document.querySelector("[data-page-notice]"),
  formError: document.querySelector("[data-form-error]"),
  hint: document.querySelector("[data-content-hint]"),
  save: document.querySelector("[data-save]"),
  saveState: document.querySelector("[data-save-state]"),
  preview: document.querySelector("[data-preview]"),
  writePanel: document.querySelector("#content-write"),
};

const state = { slug: "about", saved: null, dirty: false, saving: false, missing: false };

const current = () => PAGES.find((p) => p.slug === state.slug);

/* ---------------- Helpers ---------------- */

function setFieldError(name, message) {
  const input = f(name);
  const error = form.querySelector(`[data-error-for="${name}"]`);
  if (!input || !error) return false;
  if (message) {
    error.id = `${name}-error`;
    error.textContent = message;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
  } else {
    error.hidden = true;
    input.removeAttribute("aria-invalid");
  }
  return true;
}

function renderTabs() {
  els.tabs.innerHTML = `
    <ul class="status-tabs__list">
      ${PAGES.map(
        (p) => `
        <li><a class="status-tabs__tab" href="${SITE_BASE}admin/pages.html?page=${p.slug}" data-slug="${p.slug}"
          ${p.slug === state.slug ? 'aria-current="page"' : ""}>${p.label}</a></li>`,
      ).join("")}
    </ul>`;
  els.view.href = current().url;
  setAdminTitle(`${current().label} page`);
}

function showView(view) {
  const preview = view === "preview";
  form.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
  els.writePanel.hidden = preview;
  els.preview.hidden = !preview;
  if (preview) {
    const text = f("content").value;
    els.preview.innerHTML = text.trim() ? renderContent(text) : `<p class="panel__empty">Nothing to preview yet.</p>`;
    enhanceContent(els.preview);
  }
}

/* ---------------- Load a page ---------------- */

async function loadPage(slug) {
  state.slug = slug;
  state.dirty = false;
  state.missing = false;
  renderTabs();
  form.hidden = true;
  els.notice.hidden = true;
  els.formError.hidden = true;
  setFieldError("title", "");
  setFieldError("content", "");
  showView("write");

  const stop = showLoading(els.loadState, { lines: 5 });
  try {
    const page = await admin.pages.get(slug);
    stop();
    els.loadState.innerHTML = "";
    state.saved = page;
    f("title").value = page.title || "";
    f("content").value = page.content || "";
    els.saveState.textContent = page.updated_at
      ? `Last saved ${new Date(page.updated_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}`
      : "";
  } catch (error) {
    stop();
    if (error instanceof ApiError && error.status === 404) {
      // The page hasn't been created in the backend. Still show the form
      // in case PATCH creates it; if not, saving will say so.
      els.loadState.innerHTML = "";
      state.missing = true;
      state.saved = null;
      f("title").value = current().label === "About" ? "About us" : "Contact us";
      f("content").value = "";
      els.notice.className = "notice notice--warn";
      els.notice.textContent = `The “${slug}” page hasn't been set up in the backend yet. The API can't create pages, so ask the backend team to add it. You can write the text now and try saving.`;
      els.notice.hidden = false;
      els.saveState.textContent = "";
    } else {
      showError(els.loadState, error, () => loadPage(slug));
      return;
    }
  }

  els.hint.textContent = current().hint;
  form.hidden = false;
}

/* ---------------- Save ---------------- */

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.saving) return;
  els.formError.hidden = true;

  const title = f("title").value.trim();
  const content = f("content").value;
  if (!title) setFieldError("title", "Add a heading for the page.");
  if (!content.trim()) setFieldError("content", "Write some text for the page.");
  if (!title || !content.trim()) {
    if (els.writePanel.hidden) showView("write");
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  state.saving = true;
  els.save.disabled = true;
  els.save.textContent = "Saving…";
  try {
    const saved = await admin.pages.update(state.slug, { title, content });
    state.saved = saved;
    state.dirty = false;
    state.missing = false;
    els.notice.hidden = true;
    toast(`${current().label} page saved`);
    els.saveState.textContent = `Saved ${new Date().toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}`;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      els.formError.textContent = `Couldn't save: the “${state.slug}” page doesn't exist in the backend yet. Ask the backend team to create it, then save again. Your text is still here.`;
    } else if (error instanceof ApiError && error.status === 422) {
      const fields = error.fieldErrors;
      let matched = false;
      for (const [field, message] of Object.entries(fields)) if (setFieldError(field, message)) matched = true;
      els.formError.textContent = matched ? "" : error.message;
    } else {
      els.formError.textContent = error.message || "Couldn't save the page.";
    }
    els.formError.hidden = !els.formError.textContent;
    els.saveState.textContent = "Not saved";
  } finally {
    state.saving = false;
    els.save.disabled = false;
    els.save.textContent = "Save page";
  }
});

/* ---------------- Events ---------------- */

form.addEventListener("input", (e) => {
  state.dirty = true;
  els.saveState.textContent = "Unsaved changes";
  if (e.target.getAttribute("aria-invalid") === "true") setFieldError(e.target.name, "");
});

form.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

els.tabs.addEventListener("click", async (e) => {
  const tab = e.target.closest("a[data-slug]");
  if (!tab || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  if (tab.dataset.slug === state.slug) return;
  if (state.dirty) {
    const leave = await confirmDialog({
      title: "Leave without saving?",
      message: `Your changes to the ${current().label} page haven't been saved.`,
      confirmLabel: "Discard changes",
      danger: true,
    });
    if (!leave) return;
  }
  history.pushState(null, "", tab.href);
  loadPage(tab.dataset.slug);
});

window.addEventListener("popstate", () => loadPage(slugFromUrl()));

window.addEventListener("beforeunload", (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

function slugFromUrl() {
  const slug = new URLSearchParams(window.location.search).get("page");
  return PAGES.some((p) => p.slug === slug) ? slug : "about";
}

/* ---------------- Start ---------------- */

const user = await requireAdmin();
renderAdminLayout(user);
loadPage(slugFromUrl());
