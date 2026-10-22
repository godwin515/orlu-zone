/**
 * One news card (photo, gold category, date, title, summary, "Read story").
 * Location: js/news-card.js
 * Used by the News page, the story page ("More in …") and the event page
 * ("News about this event"). Styles: "News and Events pages" in css/site.css.
 */

import { formatDate } from "./api.js";
import { escapeHtml, safeUrl, urls, summary, featuredImage } from "./ui.js";

/* One news card. The lead card (newest story on the first page of
   "All news") is wider, with the photo beside the text. */
export function newsCard(post, category, { lead = false } = {}) {
  const date = post.published_at || post.created_at;
  const href = urls.post(post.slug);
  return `
    <article class="news-card${lead ? " news-card--lead" : ""}">
      <a class="news-card__media" href="${href}" tabindex="-1" aria-hidden="true">
        <img src="${safeUrl(featuredImage(post))}" alt="" loading="${lead ? "eager" : "lazy"}">
        ${lead ? `<span class="news-card__flag">Latest story</span>` : ""}
      </a>
      <div class="news-card__body">
        <p class="news-card__meta">
          ${category ? `<a class="news-card__category" href="${urls.category(category.slug)}">${escapeHtml(category.name)}</a>` : ""}
          ${date ? `<time datetime="${escapeHtml(date)}">${escapeHtml(formatDate(date))}</time>` : ""}
        </p>
        <h3 class="news-card__title"><a class="news-card__link" href="${href}">${escapeHtml(post.title)}</a></h3>
        <p class="news-card__summary">${escapeHtml(summary(post, lead ? 260 : 150))}</p>
        <span class="news-card__more" aria-hidden="true">Read story <span class="news-card__arrow">→</span></span>
      </div>
    </article>`;
}

