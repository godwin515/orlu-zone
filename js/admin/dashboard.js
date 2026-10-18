/**
 * Admin dashboard.
 * Location: js/admin/dashboard.js   (loaded by admin/index.html)
 *
 * Loads posts, events, media and gallery in parallel. Each part fails on
 * its own, so one slow or broken endpoint doesn't blank the whole page.
 */

import { SITE_BASE } from "../config.js";
import { admin, adapters, formatDate } from "../api.js";
import { escapeHtml, eventWhen, showLoading, showError } from "../ui.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import { statusTag, showFlash } from "./admin-ui.js";

const MAX_DRAFTS = 6;
const MAX_EVENTS = 5;

const els = {
  greeting: document.querySelector("[data-greeting]"),
  totals: document.querySelector("[data-totals]"),
  drafts: document.querySelector("[data-drafts]"),
  events: document.querySelector("[data-events]"),
};

const editPost = (id) => `${SITE_BASE}admin/post-edit.html?id=${encodeURIComponent(id)}`;
const editEvent = (id) => `${SITE_BASE}admin/event-edit.html?id=${encodeURIComponent(id)}`;

/* ---------------- Rendering ---------------- */

function greeting() {
  const hour = Number(formatDate(new Date().toISOString(), { dateStyle: undefined, hour: "numeric", hour12: false }));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function total(label, value, href, note = "") {
  return `
    <div class="total">
      <dt class="total__label">${escapeHtml(label)}</dt>
      <dd class="total__value"><a href="${href}">${value === null ? "–" : escapeHtml(String(value))}</a></dd>
      ${note ? `<dd class="total__note">${escapeHtml(note)}</dd>` : ""}
    </div>`;
}

function renderTotals({ posts, events, media, gallery }) {
  const published = posts?.filter((p) => p.status === "published").length ?? null;
  const drafts = posts?.filter((p) => p.status !== "published").length ?? null;
  const upcoming = events ? adapters.splitEvents(events.filter((e) => e.status !== "draft")).upcoming.length : null;

  els.totals.innerHTML = [
    total("Published posts", published, `${SITE_BASE}admin/posts.html`, drafts ? `${drafts} not published yet` : ""),
    total("Upcoming events", upcoming, `${SITE_BASE}admin/events.html`),
    total("Photos uploaded", media ? media.length : null, `${SITE_BASE}admin/media.html`),
    total("In the gallery", gallery ? gallery.length : null, `${SITE_BASE}admin/gallery.html`),
  ].join("");
}

function renderDrafts(posts) {
  const pending = posts
    .filter((p) => p.status !== "published")
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
    .slice(0, MAX_DRAFTS);

  if (!pending.length) {
    els.drafts.innerHTML = `
      <p class="panel__empty">Everything is published. <a href="${SITE_BASE}admin/post-edit.html">Write a new post</a>.</p>`;
    return;
  }

  els.drafts.innerHTML = `
    <ul class="row-list">
      ${pending
        .map(
          (p) => `
        <li class="row-list__item">
          <a class="row-list__title" href="${editPost(p.id)}">${escapeHtml(p.title || "Untitled post")}</a>
          <span class="row-list__meta">
            ${statusTag(p.status)}
            ${p.status === "scheduled" && p.scheduled_at
              ? `for ${escapeHtml(formatDate(p.scheduled_at, { dateStyle: "medium", timeStyle: "short" }))}`
              : `edited ${escapeHtml(formatDate(p.updated_at || p.created_at))}`}
          </span>
        </li>`,
        )
        .join("")}
    </ul>`;
}

function renderEvents(events) {
  const upcoming = adapters.splitEvents(events).upcoming.slice(0, MAX_EVENTS);

  if (!upcoming.length) {
    els.events.innerHTML = `
      <p class="panel__empty">No upcoming events. <a href="${SITE_BASE}admin/event-edit.html">Add one</a>.</p>`;
    return;
  }

  els.events.innerHTML = `
    <ul class="row-list">
      ${upcoming
        .map(
          (e) => `
        <li class="row-list__item">
          <a class="row-list__title" href="${editEvent(e.id)}">${escapeHtml(e.title)}</a>
          <span class="row-list__meta">
            ${e.status !== "published" ? statusTag(e.status) : ""}
            ${escapeHtml(eventWhen(e, { withYear: false }))}
          </span>
        </li>`,
        )
        .join("")}
    </ul>`;
}

/* ---------------- Load ---------------- */

async function load() {
  const stops = [showLoading(els.drafts, { lines: 3 }), showLoading(els.events, { lines: 3 })];

  const [posts, events, media, gallery] = await Promise.allSettled([
    admin.posts.list(),
    admin.events.list(),
    admin.media.list(),
    admin.gallery.list(),
  ]);
  stops.forEach((stop) => stop());

  const value = (r) => (r.status === "fulfilled" ? r.value : null);
  renderTotals({ posts: value(posts), events: value(events), media: value(media), gallery: value(gallery) });

  if (posts.status === "fulfilled") renderDrafts(posts.value);
  else showError(els.drafts, posts.reason, load);

  if (events.status === "fulfilled") renderEvents(events.value);
  else showError(els.events, events.reason, load);
}

const user = await requireAdmin();
renderAdminLayout(user);
setAdminTitle("Dashboard");
els.greeting.textContent = greeting();
showFlash();
load();
