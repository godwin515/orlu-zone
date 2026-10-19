/**
 * Events list.
 * Location: js/pages/events.js   (loaded by events.html)
 * URL: events.html (upcoming) or events.html?when=past[&page=<n>]
 *
 * GAP workaround: /events has no upcoming/past filter or pagination, so
 * this loads every event once and splits and pages in the browser.
 * Upcoming events are grouped by month, soonest first. Past events are
 * newest first, 10 per page.
 */

import { api, adapters, formatDate } from "../api.js";
import {
  escapeHtml,
  safeUrl,
  urls,
  summary,
  eventWhen,
  paginationHtml,
  renderShell,
  initShell,
  showLoading,
  showEmpty,
  showError,
} from "../ui.js";

const PAST_PER_PAGE = 10;

const els = {
  tabs: document.querySelector("[data-tabs]"),
  count: document.querySelector("[data-count]"),
  events: document.querySelector("[data-events]"),
  pagination: document.querySelector("[data-pagination]"),
};

const state = { upcoming: [], past: [], loaded: false };

/* ---------------- URL state ---------------- */

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    when: params.get("when") === "past" ? "past" : "upcoming",
    page: Math.max(1, parseInt(params.get("page"), 10) || 1),
  };
}

function hrefFor({ when = "upcoming", page = 1 }) {
  const params = new URLSearchParams();
  if (when === "past") params.set("when", "past");
  if (when === "past" && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/events.html${qs ? `?${qs}` : ""}`;
}

function go(next) {
  history.pushState(null, "", hrefFor(next));
  render({ scroll: true });
}

/* ---------------- Rendering ---------------- */

function eventCard(event) {
  const cancelled = event.status === "cancelled";
  const day = formatDate(event.start_at, { dateStyle: undefined, day: "numeric" });
  const month = formatDate(event.start_at, { dateStyle: undefined, month: "short" });
  const blurb = summary(event, 200);

  return `
    <article class="event-card${cancelled ? " is-cancelled" : ""}">
      <time class="date-badge" datetime="${escapeHtml(event.start_at)}">
        <span class="date-badge__day">${escapeHtml(day)}</span>
        <span class="date-badge__month">${escapeHtml(month)}</span>
      </time>
      <div class="event-card__body">
        <h3 class="event-card__title"><a href="${urls.event(event.slug)}">${escapeHtml(event.title)}</a></h3>
        <dl class="event-card__details">
          ${cancelled ? `<div><dt class="visually-hidden">Status</dt><dd class="event-card__status">Cancelled</dd></div>` : ""}
          <div><dt class="visually-hidden">When</dt><dd>${escapeHtml(eventWhen(event))}</dd></div>
          ${event.location ? `<div><dt class="visually-hidden">Where</dt><dd>${escapeHtml(event.location)}</dd></div>` : ""}
        </dl>
        ${blurb ? `<p class="event-card__summary">${escapeHtml(blurb)}</p>` : ""}
      </div>
      ${event.featured_media_url ? `
        <a class="event-card__media" href="${urls.event(event.slug)}" tabindex="-1" aria-hidden="true">
          <img src="${safeUrl(event.featured_media_url)}" alt="" loading="lazy">
        </a>` : ""}
    </article>`;
}

/** Group events under a heading per month, e.g. "November 2026". */
function byMonth(events) {
  const groups = new Map();
  for (const e of events) {
    const key = formatDate(e.start_at, { dateStyle: undefined, month: "long", year: "numeric" });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.entries()]
    .map(
      ([month, list]) => `
      <section class="month-group">
        <h2 class="month-group__title">${escapeHtml(month)}</h2>
        <div class="event-stack">${list.map(eventCard).join("")}</div>
      </section>`,
    )
    .join("");
}

function setTabs(when) {
  els.tabs.querySelectorAll("a[data-when]").forEach((a) => {
    if (a.dataset.when === when) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function render({ scroll = false } = {}) {
  const { when, page } = readUrl();
  setTabs(when);
  if (!state.loaded) return;

  els.pagination.innerHTML = "";

  if (when === "upcoming") {
    const list = state.upcoming;
    if (!list.length) {
      els.count.textContent = "";
      showEmpty(els.events, "No upcoming events are scheduled yet. Check back soon.", {
        href: hrefFor({ when: "past" }),
        label: "See past events",
      });
    } else {
      els.count.textContent = `${list.length} upcoming ${list.length === 1 ? "event" : "events"}`;
      els.events.innerHTML = byMonth(list);
    }
  } else {
    const list = state.past;
    if (!list.length) {
      els.count.textContent = "";
      showEmpty(els.events, "There are no past events yet.");
    } else {
      const result = adapters.paginate(list, page, PAST_PER_PAGE);
      if (result.page !== page) history.replaceState(null, "", hrefFor({ when, page: result.page }));
      const from = (result.page - 1) * PAST_PER_PAGE + 1;
      const to = from + result.results.length - 1;
      els.count.textContent =
        result.total_pages > 1
          ? `Showing ${from}–${to} of ${result.total} past events`
          : `${result.total} past ${result.total === 1 ? "event" : "events"}`;
      els.events.innerHTML = `<div class="event-stack">${result.results.map(eventCard).join("")}</div>`;
      els.pagination.innerHTML = paginationHtml(result, (n) => hrefFor({ when, page: n }));
    }
  }

  if (scroll) els.tabs.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- Events ---------------- */

els.tabs.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-when]");
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  go({ when: link.dataset.when, page: 1 });
});

els.pagination.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-page]");
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  go({ when: "past", page: Number(link.dataset.page) });
});

window.addEventListener("popstate", () => render());

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.events, { lines: 5 });
  els.count.textContent = "";
  els.pagination.innerHTML = "";

  try {
    const events = await api.listEvents();
    stop();
    // An event counts as upcoming until it ends (or starts, if it has no end).
    const { upcoming, past } = adapters.splitEvents(events);
    state.upcoming = upcoming;
    state.past = past;
    state.loaded = true;
    render();
  } catch (error) {
    stop();
    showError(els.events, error, load);
  }
}

renderShell();
initShell();
setTabs(readUrl().when);
load();
