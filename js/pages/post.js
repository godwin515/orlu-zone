/**
 * Single post page.
 * Location: js/pages/post.js   (loaded by post.html)
 * URL: post.html?slug=<post-slug>
 *
 * Layout (styles: "Story page" in css/site.css, plus the shared event-page
 * pieces it reuses):
 *   - top section: All news link, category, date and reading time, title,
 *     summary, share buttons, and the main photo in a gold frame
 *   - the story in a gold-bordered box (with video and photos), beside a
 *     "Story details" card
 *   - "More in <category>" news cards
 */

import { api, adapters, formatDate } from "../api.js";
import {
  escapeHtml,
  safeUrl,
  urls,
  getParam,
  featuredImage,
  categoriesFor,
  renderShell,
  initShell,
  showLoading,
  showError,
  shareHtml,
  attachShare,
} from "../ui.js";
import { renderContent, enhanceContent, videoEmbed } from "../content.js";
import { attachLightbox } from "../lightbox.js";
import { newsCard } from "../news-card.js";

const MAX_RELATED = 3;

const els = {
  body: document.querySelector("[data-article-body]"),
  relatedSection: document.querySelector("[data-related-section]"),
  relatedCategory: document.querySelector("[data-related-category]"),
  relatedLink: document.querySelector("[data-related-link]"),
  related: document.querySelector("[data-related-posts]"),
};

/* ---------------- Rendering ---------------- */

const ICON_CAL = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`;
const ICON_TAG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5l8 8-9 9-8-8z"/><circle cx="8" cy="8" r="1.5"/></svg>`;
const ICON_CLOCK = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;

/** "3 min read", from the words in the story. */
function readingTime(post) {
  const div = document.createElement("div");
  div.innerHTML = renderContent(post.content || "");
  const words = (div.textContent || "").trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

function renderNotFound() {
  document.title = "Story not found";
  els.relatedSection.hidden = true;
  els.body.innerHTML = `
    <div class="container ev-missing">
      <h1>This story isn't available</h1>
      <p>It may have been moved, unpublished, or the link may be mistyped.</p>
      <a class="button button--gold" href="${urls.posts()}">Browse all news</a>
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

function renderPost(post, category) {
  const date = post.published_at || post.created_at;
  const longDate = date ? formatDate(date, { dateStyle: "long" }) : "";
  const minutes = readingTime(post);
  const photos = photoWall(post.gallery_images);
  const hasImage = Boolean(post.featured_media_url);

  els.body.innerHTML = `
    <section class="ev-hero story-hero${hasImage ? "" : " story-hero--no-image"}">
      <div class="container ev-hero__inner">
        <div class="ev-hero__text">
          <a class="ev-hero__back" href="${urls.posts()}"><span aria-hidden="true">←</span> All news</a>
          ${category ? `<a class="ev-status story-hero__category" href="${urls.category(category.slug)}">${escapeHtml(category.name)}</a>` : ""}
          <h1 class="ev-hero__title">${escapeHtml(post.title)}</h1>
          ${post.excerpt ? `<p class="story-hero__standfirst">${escapeHtml(post.excerpt)}</p>` : ""}
          <p class="story-hero__meta">
            ${date ? `<span>${ICON_CAL}<time datetime="${escapeHtml(date)}">${escapeHtml(longDate)}</time></span>` : ""}
            <span>${ICON_CLOCK}${escapeHtml(minutes)}</span>
          </p>
          <div class="ev-hero__actions">${shareHtml(post.title)}</div>
        </div>
        ${hasImage ? `
          <div class="ev-hero__media story-hero__media">
            <figure class="ev-hero__frame">
              <img src="${safeUrl(post.featured_media_url)}" alt="">
            </figure>
          </div>` : ""}
      </div>
    </section>

    <div class="container ev-detail">
      <div class="ev-detail__main">
        <article class="ev-detail__about story-body" aria-labelledby="story-title">
          <h2 class="visually-hidden" id="story-title">${escapeHtml(post.title)}</h2>
          <div class="prose" data-prose>${renderContent(post.content)}</div>
        </article>

        ${post.video_url ? `
          <section class="ev-detail__photos" aria-labelledby="video-title">
            <h2 class="ev-detail__heading" id="video-title">Video</h2>
            <div class="story-video">${videoEmbed(post.video_url, post.title)}</div>
          </section>` : ""}

        ${photos ? `
          <section class="ev-detail__photos" aria-labelledby="photos-title">
            <h2 class="ev-detail__heading" id="photos-title">Photos</h2>
            ${photos}
          </section>` : ""}
      </div>

      <aside class="ev-detail__side" aria-label="Story details">
        <div class="ev-info">
          <h2 class="ev-info__title">Story details</h2>
          <dl class="ev-info__list">
            ${category ? `<div><dt>${ICON_TAG}<span>Category</span></dt><dd><a class="story-info__link" href="${urls.category(category.slug)}">${escapeHtml(category.name)}</a></dd></div>` : ""}
            ${date ? `<div><dt>${ICON_CAL}<span>Published</span></dt><dd>${escapeHtml(longDate)}</dd></div>` : ""}
            <div><dt>${ICON_CLOCK}<span>Reading time</span></dt><dd>${escapeHtml(minutes)}</dd></div>
          </dl>
          <p class="story-info__share-title">Share this story</p>
          <div class="story-info__share">${shareHtml(post.title)}</div>
          <a class="ev-info__directions" href="${urls.posts()}">More news <span aria-hidden="true">→</span></a>
        </div>
      </aside>
    </div>`;

  enhanceContent(els.body.querySelector("[data-prose]"));
  attachLightbox(els.body);
  els.body.querySelectorAll(".share").forEach((share) => attachShare(share.parentElement));
}

function setPageMeta(post) {
  document.title = post.title;
  const description = document.querySelector('meta[name="description"]');
  if (description && post.excerpt) description.content = post.excerpt;
}

async function renderRelated(post, category) {
  if (!category) return;
  try {
    // GAP workaround: no ?category= filter, so filter the full list here.
    const posts = await api.listPosts();
    const related = posts
      .filter((p) => p.category_id === post.category_id && p.id !== post.id)
      .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at))
      .slice(0, MAX_RELATED);
    if (!related.length) return;

    const cats = await categoriesFor(related);
    els.relatedCategory.textContent = category.name;
    els.relatedLink.href = urls.category(category.slug);
    els.relatedLink.textContent = `See all ${category.name}`;
    els.related.innerHTML = `<div class="news-grid">${related.map((p, i) => newsCard(p, cats[i])).join("")}</div>`;
    els.relatedSection.hidden = false;
  } catch {
    // Related posts are a bonus; if they fail, the article still stands.
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
    const post = await api.getPost(slug);
    stop();
    if (!post) {
      renderNotFound();
      return;
    }

    let category = null;
    try {
      category = await adapters.categoryFor(post);
    } catch {
      /* show the post without a category label */
    }

    setPageMeta(post);
    renderPost(post, category);
    const site = await shell;
    if (site?.community_name) document.title = `${post.title} | ${site.community_name}`;
    renderRelated(post, category);
  } catch (error) {
    stop();
    showError(els.body, error, load);
  }
}

renderShell();
const shell = initShell(); // fetches /site once, in parallel with the post
load();
