/**
 * One event card: a gold date tablet, the details, and the photo (if any).
 * Location: js/event-card.js
 * Used by the Events page (js/pages/events.js) and the event details page
 * (js/pages/event.js, "Other upcoming events"). Styles: "News and Events
 * pages" in css/site.css.
 */

import { formatDate } from "./api.js";
import { escapeHtml, safeUrl, urls, summary, eventWhen } from "./ui.js";

export const ICON_CLOCK = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
export const ICON_PIN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`;

/* One event: a gold date tablet, the details, and the photo (if any). */
export function eventCard(event) {
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

