/**
 * Search results.
 * Location: js/pages/search.js   (loaded by search.html)
 * URL: search.html?q=<words>[&page=<n>]
 *
 * Uses GET /search, which pages on the server (page, limit, total,
 * total_pages), so page links are ordinary links.
 */

import { SITE_BASE } from "../config.js";
import { api, formatDate } from "../api.js";
import {
  escapeHtml,
  urls,
  eventWhen,
  paginationHtml,
  renderShell,
  initShell,
  showLoading,
  showError,
} from "../ui.js";
import { attachSuggestions } from "../search-suggest.js";

const PER_PAGE = 10;

const els = {
  input: document.querySelector("[data-search-input]"),
  count: document.querySelector("[data-count]"),
  results: document.querySelector("[data-results]"),
  pagination: document.querySelector("[data-pagination]"),
};

const params = new URLSearchParams(window.location.search);
const query = (params.get("q") || "").trim();
const page = Math.max(1, parseInt(params.get("page"), 10) || 1);

const hrefFor = (n) => `${SITE_BASE}search.html?q=${encodeURIComponent(query)}${n > 1 ? `&page=${n}` : ""}`;

/* ---------------- Highlighting ---------------- */

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wrap each search word in <mark>, escaping everything else. */
function highlight(text) {
  const raw = String(text || "");
  const words = query.split(/\s+/).filter((w) => w.length > 1).map(escapeRegExp);
  if (!words.length) return escapeHtml(raw);
  // Splitting on a capturing group keeps the matches at odd indexes.
  return raw
    .split(new RegExp(`(${words.join("|")})`, "gi"))
    .map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join("");
}

/* ---------------- Rendering ---------------- */

function resultHtml(r) {
  const isEvent = r.type === "event";
  const href = isEvent ? urls.event(r.slug) : urls.post(r.slug);
  let when = "";
  if (isEvent && r.start_at) when = eventWhen({ start_at: r.start_at });
  else if (r.published_at) when = formatDate(r.published_at, { dateStyle: "long" });

  return `
    <li class="result">
      <p class="result__meta">
        <span class="result__type result__type--${isEvent ? "event" : "post"}">${isEvent ? "Event" : "News"}</span>
        ${when ? `<span>${escapeHtml(when)}</span>` : ""}
      </p>
      <h2 class="result__title"><a href="${escapeHtml(href)}">${highlight(r.title)}</a></h2>
      ${r.excerpt ? `<p class="result__excerpt">${highlight(r.excerpt)}</p>` : ""}
    </li>`;
}

async function load() {
  els.input.value = query;
  attachSuggestions(els.input);

  if (!query) {
    els.count.textContent = "";
    els.results.innerHTML = `<p class="search-hint">Type a word or two above to search news and events. For example: road, festival, scholarship.</p>`;
    els.input.focus();
    return;
  }

  const stop = showLoading(els.results, { lines: 5 });
  try {
    const res = await api.search(query, { page, limit: PER_PAGE });
    stop();

    // A page number past the end (e.g. an old link) goes to the last page.
    if (res.total > 0 && page > res.total_pages) {
      window.location.replace(hrefFor(res.total_pages));
      return;
    }

    if (!res.results?.length) {
      els.count.textContent = "";
      els.results.innerHTML = `
        <div class="state state--empty">
          <p>Nothing matched “${escapeHtml(query)}”. Try a shorter or different word.</p>
          <p class="search-hint">You can also browse <a href="${urls.posts()}">all news</a> or <a href="${urls.events()}">all events</a>.</p>
        </div>`;
      return;
    }

    const from = (res.page - 1) * res.limit + 1;
    const to = from + res.results.length - 1;
    els.count.textContent =
      res.total_pages > 1
        ? `Showing ${from}–${to} of ${res.total} results for “${query}”`
        : `${res.total} ${res.total === 1 ? "result" : "results"} for “${query}”`;

    els.results.innerHTML = `<ol class="results" start="${from}">${res.results.map(resultHtml).join("")}</ol>`;
    els.pagination.innerHTML = paginationHtml(res, hrefFor);
  } catch (error) {
    stop();
    showError(els.results, error, load);
  }
}

renderShell();
initShell().then((site) => {
  const base = query ? `Search: ${query}` : "Search";
  document.title = site?.community_name ? `${base} | ${site.community_name}` : base;
});
load();
