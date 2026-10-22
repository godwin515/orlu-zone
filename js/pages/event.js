/**
 * Single event page.
 * Location: js/pages/event.js   (loaded by event.html)
 * URL: event.html?slug=<event-slug>
 *
 * Layout (styles: "Event details page" in css/site.css):
 *   - top section: status tag, gold date block, title, when/where, countdown,
 *     Add to calendar and share, and the event photo in a gold frame
 *   - "About this event" in a gold-bordered box, beside a details card with
 *     the date, time, place, a small map and the same buttons
 *   - the event's photos, news linked to it, and other upcoming events
 */

import { api, adapters, formatDate } from "../api.js";
import { eventCard, ICON_CLOCK, ICON_PIN } from "../event-card.js";
import { newsCard } from "../news-card.js";
import {
  escapeHtml,
  safeUrl,
  urls,
  getParam,
  eventWhen,
  summary,
  featuredImage,
  categoriesFor,
  shareHtml,
  attachShare,
  renderShell,
  initShell,
  showLoading,
  showError,
} from "../ui.js";
import { renderContent, enhanceContent } from "../content.js";
import { attachLightbox } from "../lightbox.js";

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
    "PRODID:-//Orlu Land Compendium//Events//EN",
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

const STATE_LABELS = {
  upcoming: "Upcoming event",
  happening: "Happening now",
  ended: "This event has ended",
  cancelled: "Cancelled",
};

const ICON_CAL = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`;

/** "Starts in 23 days", "Starts tomorrow", "Starts today" (upcoming events only). */
function countdown(event, now = new Date()) {
  const start = new Date(event.start_at);
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(start) - day(now)) / 86400000);
  if (days <= 0) return "Starts today";
  if (days === 1) return "Starts tomorrow";
  if (days < 60) return `Starts in ${days} days`;
  const months = Math.round(days / 30);
  return `Starts in about ${months} months`;
}

function renderNotFound() {
  document.title = "Event not found";
  els.newsSection.hidden = true;
  els.moreSection.hidden = true;
  els.body.innerHTML = `
    <div class="container ev-missing">
      <h1>This event isn't available</h1>
      <p>It may have been moved, unpublished, or the link may be mistyped.</p>
      <a class="button button--gold" href="${urls.events()}">See all events</a>
    </div>`;
}

function photoWall(images) {
  const list = [...(images || [])]
    .filter((img) => img?.public_url)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (!list.length) return "";
  return `
    <ul class="ev-photos" data-photo-grid>
      ${list
        .map(
          (img, i) => `
        <li>
          <a class="photo-grid__item ev-photos__item" href="${safeUrl(img.public_url)}" data-index="${i}"
            data-caption="${escapeHtml(img.caption || "")}" data-alt="${escapeHtml(img.alt_text || "")}"
            aria-label="View photo ${i + 1} full size">
            <img src="${safeUrl(img.public_url)}" alt="${escapeHtml(img.alt_text || img.caption || "")}" loading="lazy">
          </a>
          ${img.caption ? `<p class="ev-photos__caption">${escapeHtml(img.caption)}</p>` : ""}
        </li>`,
        )
        .join("")}
    </ul>`;
}

function renderEvent(event) {
  const state = eventState(event);
  const mapUrl = event.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`
    : null;
  const mapEmbed = event.location
    ? `https://www.google.com/maps?q=${encodeURIComponent(event.location)}&output=embed`
    : null;
  const canAddToCalendar = state === "upcoming" || state === "happening";
  const weekday = formatDate(event.start_at, { dateStyle: undefined, weekday: "long" });
  const day = formatDate(event.start_at, { dateStyle: undefined, day: "numeric" });
  const month = formatDate(event.start_at, { dateStyle: undefined, month: "long" });
  const year = formatDate(event.start_at, { dateStyle: undefined, year: "numeric" });
  const photos = photoWall(event.gallery_images);
  const calendarButton = canAddToCalendar
    ? `<button type="button" class="button button--gold ev-detail__calendar" data-add-calendar>${ICON_CAL}<span>Add to calendar</span></button>`
    : "";

  els.body.innerHTML = `
    <section class="ev-hero${state === "cancelled" ? " is-cancelled" : ""}">
      <div class="container ev-hero__inner">
        <div class="ev-hero__text">
          <a class="ev-hero__back" href="${urls.events()}"><span aria-hidden="true">←</span> All events</a>
          <p class="ev-status ev-status--${state}">${STATE_LABELS[state]}</p>
          <h1 class="ev-hero__title">${escapeHtml(event.title)}</h1>
          <dl class="ev-hero__facts">
            <div><dt class="visually-hidden">When</dt>
              <dd>${ICON_CLOCK}<span><time datetime="${escapeHtml(event.start_at)}">${escapeHtml(eventWhen(event))}</time>
                <small>Nigerian time (WAT)</small></span></dd></div>
            ${event.location ? `<div><dt class="visually-hidden">Where</dt><dd>${ICON_PIN}<span>${escapeHtml(event.location)}</span></dd></div>` : ""}
          </dl>
          ${state === "upcoming" ? `<p class="ev-hero__countdown">${escapeHtml(countdown(event))}</p>` : ""}
          <div class="ev-hero__actions">
            ${calendarButton}
            ${shareHtml(event.title)}
          </div>
        </div>
        <div class="ev-hero__media">
          <figure class="ev-hero__frame">
            <img src="${safeUrl(featuredImage(event))}" alt="">
          </figure>
          <time class="ev-date ev-date--big" datetime="${escapeHtml(event.start_at)}" aria-hidden="true">
            <span class="ev-date__weekday">${escapeHtml(weekday)}</span>
            <span class="ev-date__day">${escapeHtml(day)}</span>
            <span class="ev-date__month">${escapeHtml(month)} ${escapeHtml(year)}</span>
          </time>
        </div>
      </div>
    </section>

    <div class="container ev-detail">
      <div class="ev-detail__main">
        <section class="ev-detail__about" aria-labelledby="about-event">
          <h2 class="ev-detail__heading" id="about-event">About this event</h2>
          ${event.description
            ? `<div class="prose" data-prose>${renderContent(event.description)}</div>`
            : `<p class="ev-detail__empty">More details about this event will be shared soon.</p>`}
        </section>

        ${photos ? `
          <section class="ev-detail__photos" aria-labelledby="photos-title">
            <h2 class="ev-detail__heading" id="photos-title">Photos</h2>
            ${photos}
          </section>` : ""}
      </div>

      <aside class="ev-detail__side" aria-label="Event details">
        <div class="ev-info">
          <h2 class="ev-info__title">Event details</h2>
          <dl class="ev-info__list">
            <div><dt>${ICON_CAL}<span>Date</span></dt><dd>${escapeHtml(`${weekday}, ${day} ${month} ${year}`)}</dd></div>
            <div><dt>${ICON_CLOCK}<span>Time</span></dt><dd>${escapeHtml(eventWhen(event).split(", ").slice(-1)[0])} <small>WAT</small></dd></div>
            ${event.location ? `<div><dt>${ICON_PIN}<span>Venue</span></dt><dd>${escapeHtml(event.location)}</dd></div>` : ""}
          </dl>
          ${mapEmbed ? `
            <div class="ev-info__map">
              <iframe src="${escapeHtml(mapEmbed)}" title="Map: ${escapeHtml(event.location)}" loading="lazy"
                referrerpolicy="no-referrer-when-downgrade"></iframe>
            </div>
            <a class="ev-info__directions" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener">Get directions <span aria-hidden="true">→</span></a>` : ""}
        </div>
      </aside>
    </div>`;

  const prose = els.body.querySelector("[data-prose]");
  if (prose) enhanceContent(prose);
  attachLightbox(els.body);
  els.body.querySelectorAll(".share").forEach((share) => attachShare(share.parentElement));
  els.body.querySelectorAll("[data-add-calendar]").forEach((b) => b.addEventListener("click", () => downloadIcs(event)));
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
    els.news.innerHTML = `<div class="news-grid">${linked.map((p, i) => newsCard(p, cats[i])).join("")}</div>`;
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
    els.more.innerHTML = `<div class="ev-stack">${more.map(eventCard).join("")}</div>`;
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
