/**
 * Single post page.
 * Location: js/pages/post.js   (loaded by post.html)
 * URL: post.html?slug=<post-slug>
 */

import { api, adapters, formatDate } from "../api.js";
import {
  escapeHtml,
  safeUrl,
  urls,
  getParam,
  postEntry,
  categoriesFor,
  renderShell,
  initShell,
  showLoading,
  showError,
  shareHtml,
  attachShare,
} from "../ui.js";
import { renderContent, enhanceContent, videoEmbed } from "../content.js";
import { photoGrid, attachLightbox } from "../lightbox.js";

const MAX_RELATED = 3;

const els = {
  body: document.querySelector("[data-article-body]"),
  relatedSection: document.querySelector("[data-related-section]"),
  relatedCategory: document.querySelector("[data-related-category]"),
  relatedLink: document.querySelector("[data-related-link]"),
  related: document.querySelector("[data-related-posts]"),
};

/* ---------------- Rendering ---------------- */

function renderNotFound() {
  document.title = "Post not found";
  els.relatedSection.hidden = true;
  els.body.innerHTML = `
    <div class="not-found">
      <h1>This post isn't available</h1>
      <p>It may have been moved, unpublished, or the link may be mistyped.</p>
      <a class="button" href="${urls.posts()}">Browse all news</a>
    </div>`;
}

function renderPost(post, category) {
  const date = post.published_at || post.created_at;
  const hasImage = Boolean(post.featured_media_url);
  const gallery = photoGrid(post.gallery_images);

  els.body.innerHTML = `
    <header class="article__header">
      <p class="entry__meta">
        ${category ? `<a class="entry__category" href="${urls.category(category.slug)}">${escapeHtml(category.name)}</a>` : ""}
        ${date ? `<time datetime="${escapeHtml(date)}">${escapeHtml(formatDate(date, { dateStyle: "long" }))}</time>` : ""}
      </p>
      <h1 class="article__title">${escapeHtml(post.title)}</h1>
      ${post.excerpt ? `<p class="article__standfirst">${escapeHtml(post.excerpt)}</p>` : ""}
      ${shareHtml(post.title)}
    </header>

    ${hasImage ? `
      <figure class="article__image">
        <img src="${safeUrl(post.featured_media_url)}" alt="">
      </figure>` : ""}

    <div class="prose" data-prose>${renderContent(post.content)}</div>

    ${post.video_url ? `<div class="article__video">${videoEmbed(post.video_url, post.title)}</div>` : ""}

    ${gallery ? `
      <section class="article__gallery" aria-labelledby="photos-title">
        <h2 id="photos-title">Photos</h2>
        ${gallery}
      </section>` : ""}

    <p class="article__back"><a href="${urls.posts()}">Back to all news</a></p>`;

  enhanceContent(els.body.querySelector("[data-prose]"));
  attachLightbox(els.body);

  attachShare(els.body);
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
    els.relatedLink.textContent = `All ${category.name}`;
    els.related.innerHTML = `<div class="post-grid">${related.map((p, i) => postEntry(p, cats[i])).join("")}</div>`;
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
