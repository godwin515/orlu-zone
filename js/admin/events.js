/**
 * Admin events list.
 * Location: js/admin/events.js   (loaded by admin/events.html)
 *
 * Loads GET /admin/events (every event, any status) and filters, searches
 * and pages in the browser. Delete uses DELETE /admin/events/{id}.
 *
 * Views:
 *   upcoming  - published events that haven't ended, soonest first (default)
 *   past      - published events that have ended, newest first
 *   draft     - drafts, by date
 *   cancelled - cancelled events, by date
 *   all       - everything: upcoming first, then past
 */

import { SITE_BASE } from "../config.js";
import { admin, adapters } from "../api.js";
import { escapeHtml, urls, eventWhen, paginationHtml, showLoading, showError } from "../ui.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import { statusTag, confirmDialog, toast, showFlash } from "./admin-ui.js";

const PER_PAGE = 20;
const VIEWS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "draft", label: "Drafts" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

const els = {
  tabs: document.querySelector("[data-view-tabs]"),
  q: document.querySelector("[data-filter-q]"),
  count: document.querySelector("[data-count]"),
  list: document.querySelector("[data-events]"),
  pagination: document.querySelector("[data-pagination]"),
};

const state = { events: [] };

const editUrl = (id) => `${SITE_BASE}admin/event-edit.html?id=${encodeURIComponent(id)}`;

/* ---------------- Grouping ---------------- */

const soonestFirst = (a, b) => new Date(a.start_at) - new Date(b.start_at);
const newestFirst = (a, b) => new Date(b.start_at) - new Date(a.start_at);

/** Every view's list, computed once per render. */
function groups(now = new Date()) {
  const published = state.events.filter((e) => e.status === "published");
  const { upcoming, past } = adapters.splitEvents(published, now);
  return {
    upcoming: [...upcoming].sort(soonestFirst),
    past: [...past].sort(newestFirst),
    draft: state.events.filter((e) => e.status === "draft").sort(newestFirst),
    cancelled: state.events.filter((e) => e.status === "cancelled").sort(newestFirst),
    all: [
      ...adapters.splitEvents(state.events, now).upcoming.sort(soonestFirst),
      ...adapters.splitEvents(state.events, now).past.sort(newestFirst),
    ],
  };
}

/* ---------------- URL state ---------------- */

function readFilters() {
  const p = new URLSearchParams(window.location.search);
  return {
    view: VIEWS.some((v) => v.key === p.get("view")) ? p.get("view") : "upcoming",
    q: p.get("q") || "",
    page: Math.max(1, parseInt(p.get("page"), 10) || 1),
  };
}

function hrefFor(f) {
  const p = new URLSearchParams();
  if (f.view && f.view !== "upcoming") p.set("view", f.view);
  if (f.q) p.set("q", f.q);
  if (f.page > 1) p.set("page", String(f.page));
  const qs = p.toString();
  return `${SITE_BASE}admin/events.html${qs ? `?${qs}` : ""}`;
}

function update(changes, { push = true } = {}) {
  const url = hrefFor({ ...readFilters(), ...changes });
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
  render();
}

/* ---------------- Rendering ---------------- */

function renderTabs(active, g) {
  els.tabs.innerHTML = `
    <ul class="status-tabs__list">
      ${VIEWS.map(
        (v) => `
        <li><a class="status-tabs__tab" href="${escapeHtml(hrefFor({ ...readFilters(), view: v.key, page: 1 }))}"
          data-view="${v.key}" ${v.key === active ? 'aria-current="page"' : ""}>
          ${v.label} <span class="status-tabs__count">${g[v.key].length}</span>
        </a></li>`,
      ).join("")}
    </ul>`;
}

function rowHtml(event, now) {
  const ended = new Date(event.end_at || event.start_at) < now;
  const showOnSite = event.status === "published" || event.status === "cancelled";
  return `
    <tr data-id="${escapeHtml(event.id)}">
      <td class="cell-title" data-label="Title">
        <a class="cell-title__link" href="${editUrl(event.id)}">${escapeHtml(event.title || "Untitled event")}</a>
      </td>
      <td data-label="Status">
        ${statusTag(event.status)}
        ${event.status === "published" && ended ? '<span class="tag tag--ended">Ended</span>' : ""}
      </td>
      <td data-label="When" class="cell-date">${escapeHtml(eventWhen(event, { withYear: true }))}</td>
      <td data-label="Where">${escapeHtml(event.location || "—")}</td>
      <td class="cell-actions">
        <a class="link-button" href="${editUrl(event.id)}">Edit</a>
        ${showOnSite ? `<a class="link-button" href="${escapeHtml(urls.event(event.slug))}" target="_blank" rel="noopener">View</a>` : ""}
        <button class="link-button link-button--danger" type="button" data-delete="${escapeHtml(event.id)}">Delete</button>
      </td>
    </tr>`;
}

const EMPTY = {
  upcoming: "No upcoming events. Add one so it shows on the homepage.",
  past: "No past events yet.",
  draft: "No drafts.",
  cancelled: "No cancelled events.",
  all: "No events yet.",
};

function render() {
  const f = readFilters();
  const now = new Date();
  const g = groups(now);
  renderTabs(f.view, g);
  if (document.activeElement !== els.q) els.q.value = f.q;

  if (!state.events.length) {
    els.count.textContent = "";
    els.pagination.innerHTML = "";
    els.list.innerHTML = `
      <div class="empty-block">
        <p>No events yet. Published events appear on the website's Events page and homepage.</p>
        <a class="button" href="${SITE_BASE}admin/event-edit.html">Add the first event</a>
      </div>`;
    return;
  }

  const q = f.q.trim().toLowerCase();
  const list = g[f.view].filter(
    (e) => !q || (e.title || "").toLowerCase().includes(q) || (e.location || "").toLowerCase().includes(q),
  );

  if (!list.length) {
    els.count.textContent = "";
    els.pagination.innerHTML = "";
    els.list.innerHTML = q
      ? `<div class="empty-block"><p>No events match “${escapeHtml(f.q)}” here.</p>
           <button class="button button--quiet" type="button" data-clear>Clear search</button></div>`
      : `<div class="empty-block"><p>${EMPTY[f.view]}</p>
           ${f.view === "upcoming" ? `<a class="button" href="${SITE_BASE}admin/event-edit.html">New event</a>` : ""}</div>`;
    return;
  }

  const result = adapters.paginate(list, f.page, PER_PAGE);
  if (result.page !== f.page) history.replaceState(null, "", hrefFor({ ...f, page: result.page }));

  const from = (result.page - 1) * PER_PAGE + 1;
  els.count.textContent =
    result.total_pages > 1
      ? `Showing ${from}–${from + result.results.length - 1} of ${result.total} events`
      : `${result.total} ${result.total === 1 ? "event" : "events"}`;

  els.list.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">When (Nigerian time)</th>
            <th scope="col">Where</th>
            <th scope="col"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>${result.results.map((e) => rowHtml(e, now)).join("")}</tbody>
      </table>
    </div>`;

  els.pagination.innerHTML = paginationHtml(result, (n) => hrefFor({ ...f, page: n }));
}

/* ---------------- Delete ---------------- */

async function deleteEvent(id, button) {
  const event = state.events.find((e) => e.id === id);
  if (!event) return;

  const ok = await confirmDialog({
    title: "Delete this event?",
    message: `“${event.title || "Untitled event"}” will be removed from the website and can't be recovered. To keep it visible as called off, edit it and set it to Cancelled instead.`,
    confirmLabel: "Delete event",
    danger: true,
  });
  if (!ok) return;

  button.disabled = true;
  button.textContent = "Deleting…";
  try {
    await admin.events.remove(id);
    state.events = state.events.filter((e) => e.id !== id);
    render();
    toast("Event deleted");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Delete";
    toast(error.message || "Couldn't delete the event.", "error");
  }
}

/* ---------------- Events ---------------- */

els.tabs.addEventListener("click", (e) => {
  const tab = e.target.closest("a[data-view]");
  if (!tab || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  update({ view: tab.dataset.view, page: 1 });
});

let qTimer;
els.q.addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => update({ q: els.q.value.trim(), page: 1 }, { push: false }), 200);
});

els.list.addEventListener("click", (e) => {
  const del = e.target.closest("[data-delete]");
  if (del) {
    deleteEvent(del.dataset.delete, del);
    return;
  }
  if (e.target.closest("[data-clear]")) {
    els.q.value = "";
    update({ q: "", page: 1 });
  }
});

els.pagination.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-page]");
  if (!link || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  update({ page: Number(link.dataset.page) });
  document.querySelector(".admin-head").scrollIntoView({ behavior: "smooth" });
});

window.addEventListener("popstate", render);

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.list, { lines: 6 });
  try {
    state.events = await admin.events.list();
    stop();
    render();
  } catch (error) {
    stop();
    showError(els.list, error, load);
  }
}

const user = await requireAdmin();
renderAdminLayout(user);
setAdminTitle("Events");
showFlash();
load();
