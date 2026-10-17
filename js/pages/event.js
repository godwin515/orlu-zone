/**
 * Single event page.
 * Location: js/pages/event.js   (loaded by event.html)
 * URL: event.html?slug=<event-slug>
 */

import { api, adapters } from "../api.js";
import {
  escapeHtml,
  safeUrl,
  urls,
  getParam,
  eventWhen,
  eventRow,
  postEntry,
  categoriesFor,
  shareHtml,
  attachShare,
  renderShell,
  initShell,
  showLoading,
  showError,
} from "../ui.js";
import { renderContent, enhanceContent } from "../content.js";
import { photoGrid, attachLightbox } from "../lightbox.js";

const MAX_NEWS = 3;
const MAX_MORE = 3;

const els = {
  body: document.querySelector("[data-event-body]"),
  newsSection: document.querySelector("[data-news-section]"),
  news: document.querySelector("[data-event-news]"),
  moreSection: document.querySelector("[data-more-section]"),
  more: document.querySelector("[data-more-events]"),
};

/* ---------------- Status ---------------- */

function eventState(event, now = new Date()) {
  if (event.status === "cancelled") return "cancelled";
  const end = new Date(event.end_at || event.start_at);
  const start = new Date(event.start_at);
  if (end < now) return "ended";
  if (start <= now) return "happening";
  return "upcoming";
}

const NOTICES = {
  cancelled: "This event has been cancelled.",
  ended: "This event has ended.",
  happening: "This event is happening now.",
};

/* ---------------- Add to calendar (.ics) ---------------- */

function icsDate(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function plainText(content) {
  const div = document.createElement("div");
  div.innerHTML = renderContent(content);
  // Keep a line break after each paragraph, list item and heading.
  div.querySelectorAll("p, li, h1, h2, h3, h4, blockquote, br").forEach((el) => el.after("\n"));
  return (div.textContent || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function downloadIcs(event) {
  // No end time: assume two hours so calendars show a sensible block.
  const end = event.end_at || new Date(new Date(event.start_at).getTime() + 2 * 3600 * 1000).toISOString();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orlu Community//Events//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.id}@orlu-community`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(event.start_at)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(event.title)}`,
    event.location ? `LOCATION:${icsText(event.location)}` : null,
    `DESCRIPTION:${icsText(`${plainText(event.description).slice(0, 500)}\n\n${window.location.href}`)}`,
    `URL:${window.location.href}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.slug || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- Rendering ---------------- */

function renderNotFound() {
  document.title = "Event not found";
  els.newsSection.hidden = true;
  els.moreSection.hidden = true;
  els.body.innerHTML = `
    <div class="not-found">
      <h1>This event isn't available</h1>
      <p>It may have been moved, unpublished, or the link may be mistyped.</p>
      <a class="button" href="${urls.events()}">See all events</a>
    </div>`;
}

function renderEvent(event) {
  const state = eventState(event);
  const gallery = photoGrid(event.gallery_images);
  const mapUrl = event.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`
    : null;
  const canAddToCalendar = state === "upcoming" || state === "happening";

  els.body.innerHTML = `
    <header class="article__header">
      ${NOTICES[state] ? `<p class="event-notice event-notice--${state}" role="status">${NOTICES[state]}</p>` : ""}
      <h1 class="article__title${state === "cancelled" ? " is-cancelled" : ""}">${escapeHtml(event.title)}</h1>

      <dl class="event-facts">
        <div class="event-facts__row">
          <dt>When</dt>
          <dd>
            <time datetime="${escapeHtml(event.start_at)}">${escapeHtml(eventWhen(event))}</time>
            <span class="event-facts__note">Nigerian time (WAT)</span>
          </dd>
        </div>
        ${event.location ? `
          <div class="event-facts__row">
            <dt>Where</dt>
            <dd>
              ${escapeHtml(event.location)}
              <a class="event-facts__link" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener">Open in Google Maps</a>
            </dd>
          </div>` : ""}
      </dl>

      <div class="event-actions">
        ${canAddToCalendar ? '<button type="button" class="button" data-add-calendar>Add to calendar</button>' : ""}
        ${shareHtml(event.title)}
      </div>
    </header>

    ${event.featured_media_url ? `
      <figure class="article__image">
        <img src="${safeUrl(event.featured_media_url)}" alt="">
      </figure>` : ""}

    ${event.description ? `
      <section aria-labelledby="about-event">
        <h2 class="visually-hidden" id="about-event">About this event</h2>
        <div class="prose" data-prose>${renderContent(event.description)}</div>
      </section>` : ""}

    ${gallery ? `
      <section class="article__gallery" aria-labelledby="photos-title">
        <h2 id="photos-title">Photos</h2>
        ${gallery}
      </section>` : ""}

    <p class="article__back"><a href="${urls.events()}">Back to all events</a></p>`;

  const prose = els.body.querySelector("[data-prose]");
  if (prose) enhanceContent(prose);
  attachLightbox(els.body);
  attachShare(els.body);
  els.body.querySelector("[data-add-calendar]")?.addEventListener("click", () => downloadIcs(event));
}

function setPageMeta(event, siteName) {
  document.title = siteName ? `${event.title} | ${siteName}` : event.title;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = `${eventWhen(event)}${event.location ? `, ${event.location}` : ""}`;
}

/* News posts linked to this event through post.event_id. */
async function renderEventNews(event) {
  try {
    const posts = await api.listPosts();
    const linked = posts
      .filter((p) => p.event_id === event.id)
      .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at))
      .slice(0, MAX_NEWS);
    if (!linked.length) return;
    const cats = await categoriesFor(linked);
    els.news.innerHTML = `<div class="post-grid">${linked.map((p, i) => postEntry(p, cats[i])).join("")}</div>`;
    els.newsSection.hidden = false;
  } catch {
    /* optional section */
  }
}

async function renderMoreEvents(event) {
  try {
    const events = await api.listEvents();
    const more = adapters
      .splitEvents(events)
      .upcoming.filter((e) => e.id !== event.id && e.status !== "cancelled")
      .slice(0, MAX_MORE);
    if (!more.length) return;
    els.more.innerHTML = `<div class="event-list">${more.map(eventRow).join("")}</div>`;
    els.moreSection.hidden = false;
  } catch {
    /* optional section */
  }
}

/* ---------------- Load ---------------- */

async function load() {
  const slug = getParam("slug");
  if (!slug) {
    renderNotFound();
    return;
  }

  const stop = showLoading(els.body, { lines: 6 });
  try {
    const event = await api.getEvent(slug);
    stop();
    if (!event) {
      renderNotFound();
      return;
    }
    renderEvent(event);
    const site = await shell;
    setPageMeta(event, site?.community_name);
    renderEventNews(event);
    renderMoreEvents(event);
  } catch (error) {
    stop();
    showError(els.body, error, load);
  }
}

renderShell();
const shell = initShell(); // fetches /site once, in parallel with the event
load();
