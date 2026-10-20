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

const ICON_CLOCK = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const ICON_PIN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`;

/* One event: a gold date tablet, the details, and the photo (if any). */
function eventCard(event) {
  const cancelled = event.status === "cancelled";
  const day = formatDate(event.start_at, { dateStyle: undefined, day: "numeric" });
  const month = formatDate(event.start_at, { dateStyle: undefined, month: "short" });
  const weekday = formatDate(event.start_at, { dateStyle: undefined, weekday: "short" });
  const blurb = summary(event, 200);
  const href = urls.event(event.slug);

  return `
    <article class="ev-card${cancelled ? " is-cancelled" : ""}${event.featured_media_url ? " has-media" : ""}">
      <time class="ev-date" datetime="${escapeHtml(event.start_at)}">
        <span class="ev-date__weekday">${escapeHtml(weekday)}</span>
        <span class="ev-date__day">${escapeHtml(day)}</span>
        <span class="ev-date__month">${escapeHtml(month)}</span>
      </time>
      <div class="ev-card__body">
        ${cancelled ? `<p class="ev-card__status">Cancelled</p>` : ""}
        <h3 class="ev-card__title"><a class="ev-card__link" href="${href}">${escapeHtml(event.title)}</a></h3>
        <dl class="ev-card__details">
          <div><dt class="visually-hidden">When</dt><dd>${ICON_CLOCK}<span>${escapeHtml(eventWhen(event))}</span></dd></div>
          ${event.location ? `<div><dt class="visually-hidden">Where</dt><dd>${ICON_PIN}<span>${escapeHtml(event.location)}</span></dd></div>` : ""}
        </dl>
        ${blurb ? `<p class="ev-card__summary">${escapeHtml(blurb)}</p>` : ""}
        <span class="ev-card__more" aria-hidden="true">View details <span class="ev-card__arrow">→</span></span>
      </div>
      ${event.featured_media_url ? `
        <a class="ev-card__media" href="${href}" tabindex="-1" aria-hidden="true">
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
      <section class="ev-month">
        <h2 class="ev-month__title"><span>${escapeHtml(month)}</span>
          <span class="ev-month__count">${list.length} ${list.length === 1 ? "event" : "events"}</span></h2>
        <div class="ev-stack">${list.map(eventCard).join("")}</div>
      </section>`,
    )
    .join("");
}

const sectionTitle = document.querySelector("[data-section-title]");

function setTabs(when) {
  if (sectionTitle) sectionTitle.textContent = when === "past" ? "Past gatherings" : "Upcoming gatherings";
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
      els.events.innerHTML = `<div class="ev-stack">${result.results.map(eventCard).join("")}</div>`;
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
