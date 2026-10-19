/**
 * News list.
 * Location: js/pages/posts.js   (loaded by posts.html)
 * URL: posts.html, posts.html?category=<slug>, either with &page=<n>
 *
 * The selected category's heading and description come from
 * GET /categories/{slug}.
 *
 * GAP workaround: the API has no category filter or pagination on /posts,
 * so this loads every post once and filters and pages in the browser.
 * Switching category or page updates the URL without reloading, so links
 * stay shareable and the back button works.
 */

import { api, adapters } from "../api.js";
import {
  escapeHtml,
  urls,
  postEntry,
  paginationHtml,
  renderShell,
  initShell,
  showLoading,
  showEmpty,
  showError,
} from "../ui.js";

const PER_PAGE = 12;
const DEFAULT_LEAD = "Announcements, updates and stories from across the community.";

const els = {
  title: document.querySelector("[data-page-title]"),
  lead: document.querySelector("[data-page-lead]"),
  filters: document.querySelector("[data-filters]"),
  count: document.querySelector("[data-count]"),
  posts: document.querySelector("[data-posts]"),
  pagination: document.querySelector("[data-pagination]"),
};

const state = {
  posts: [], // all published posts, newest first
  categories: [], // all categories, A–Z
  categoryById: new Map(),
  siteName: null,
};

/* ---------------- URL state ---------------- */

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  const page = Math.max(1, parseInt(params.get("page"), 10) || 1);
  return { category: params.get("category") || "", page };
}

function hrefFor({ category = "", page = 1 }) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/posts.html${qs ? `?${qs}` : ""}`;
}

function go(next) {
  history.pushState(null, "", hrefFor(next));
  render({ scroll: true });
}

/* ---------------- Rendering ---------------- */

function renderFilters(activeSlug) {
  // Only show categories that actually have posts.
  const used = new Set(state.posts.map((p) => p.category_id));
  const cats = state.categories.filter((c) => used.has(c.id));
  if (!cats.length) {
    els.filters.innerHTML = "";
    return;
  }

  const chip = (label, slug) => {
    const active = slug === activeSlug;
    return `<li><a class="chip" href="${escapeHtml(hrefFor({ category: slug }))}" data-category="${escapeHtml(slug)}"
      ${active ? 'aria-current="page"' : ""}>${escapeHtml(label)}</a></li>`;
  };

  els.filters.innerHTML = `<ul class="filters__list">${chip("All news", "")}${cats.map((c) => chip(c.name, c.slug)).join("")}</ul>`;
}

function renderHeading(category) {
  els.title.textContent = category ? category.name : "News";
  els.lead.textContent = category?.description || (category ? "" : DEFAULT_LEAD);
  els.lead.hidden = !els.lead.textContent;
  const page = category ? category.name : "News";
  document.title = state.siteName ? `${page} | ${state.siteName}` : page;
}

/*
 * Category details (name, description) come from GET /categories/{slug},
 * as the contract describes. Fetched once per category, then the heading
 * is refreshed with the latest wording.
 */
const detailsFetched = new Set();
function loadCategoryDetails(slug) {
  if (!slug || detailsFetched.has(slug)) return;
  detailsFetched.add(slug);
  api
    .getCategory(slug)
    .then((details) => {
      if (!details) return;
      const i = state.categories.findIndex((c) => c.slug === slug);
      if (i === -1) state.categories.push(details);
      else state.categories[i] = { ...state.categories[i], ...details };
      state.categoryById.set(details.id, state.categories.find((c) => c.slug === slug));
      if (readUrl().category === slug) render();
    })
    .catch(() => {
      /* the list's copy is good enough */
    });
}

function render({ scroll = false } = {}) {
  const { category: slug, page } = readUrl();
  const category = slug ? state.categories.find((c) => c.slug === slug) : null;
  loadCategoryDetails(slug);

  renderFilters(slug);
  renderHeading(category);

  if (slug && !category) {
    els.count.textContent = "";
    els.pagination.innerHTML = "";
    showEmpty(els.posts, "That category doesn't exist. It may have been renamed.", {
      href: hrefFor({}),
      label: "See all news",
    });
    return;
  }

  const filtered = category ? state.posts.filter((p) => p.category_id === category.id) : state.posts;

  if (!filtered.length) {
    els.count.textContent = "";
    els.pagination.innerHTML = "";
    showEmpty(
      els.posts,
      category ? `Nothing has been posted in ${category.name} yet.` : "No news has been posted yet.",
      category ? { href: hrefFor({}), label: "See all news" } : null,
    );
    return;
  }

  const result = adapters.paginate(filtered, page, PER_PAGE);

  // A page number past the end (e.g. an old link) snaps to the last page.
  if (result.page !== page) {
    history.replaceState(null, "", hrefFor({ category: slug, page: result.page }));
  }

  const from = (result.page - 1) * PER_PAGE + 1;
  const to = from + result.results.length - 1;
  els.count.textContent =
    result.total_pages > 1
      ? `Showing ${from}–${to} of ${result.total} posts`
      : `${result.total} ${result.total === 1 ? "post" : "posts"}`;

  els.posts.innerHTML = `
    <div class="post-grid">
      ${result.results.map((p) => postEntry(p, state.categoryById.get(p.category_id) || null)).join("")}
    </div>`;

  els.pagination.innerHTML = paginationHtml(result, (n) => hrefFor({ category: slug, page: n }));

  if (scroll) {
    els.filters.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ---------------- Events ---------------- */

// Intercept filter and page clicks so they don't reload the page.
els.filters.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-category]");
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  go({ category: link.dataset.category, page: 1 });
});

els.pagination.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-page]");
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  go({ category: readUrl().category, page: Number(link.dataset.page) });
});

window.addEventListener("popstate", () => render());

/* ---------------- Load ---------------- */

const byNewest = (a, b) =>
  new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at);

async function load() {
  const stop = showLoading(els.posts, { lines: 6 });
  els.count.textContent = "";
  els.pagination.innerHTML = "";

  try {
    const [posts, categories] = await Promise.all([
      api.listPosts(),
      api.listCategories().catch(() => []), // the list still works without labels
    ]);
    stop();

    state.posts = [...posts].sort(byNewest);
    state.categories = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    state.categoryById = new Map(state.categories.map((c) => [c.id, c]));
    render();
  } catch (error) {
    stop();
    showError(els.posts, error, load);
  }
}

renderShell();
initShell().then((site) => {
  state.siteName = site?.community_name || null;
});
load();
