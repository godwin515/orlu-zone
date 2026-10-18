/**
 * Admin posts list.
 * Location: js/admin/posts.js   (loaded by admin/posts.html)
 *
 * Loads GET /admin/posts (every post, any status) plus categories and
 * authors for their names, then filters, searches and pages in the
 * browser (the API has no filters or paging on this endpoint).
 * Delete uses DELETE /admin/posts/{id} after a confirmation.
 */

import { SITE_BASE } from "../config.js";
import { admin, adapters, formatDate } from "../api.js";
import { escapeHtml, urls, paginationHtml, showLoading, showError } from "../ui.js";
import { requireAdmin } from "./guard.js";
import { renderAdminLayout, setAdminTitle } from "./layout.js";
import { statusTag, confirmDialog, toast, showFlash } from "./admin-ui.js";

const PER_PAGE = 20;
const STATUSES = [
  { key: "", label: "All" },
  { key: "published", label: "Published" },
  { key: "draft", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
];

const els = {
  tabs: document.querySelector("[data-status-tabs]"),
  category: document.querySelector("[data-filter-category]"),
  q: document.querySelector("[data-filter-q]"),
  count: document.querySelector("[data-count]"),
  list: document.querySelector("[data-posts]"),
  pagination: document.querySelector("[data-pagination]"),
};

const state = {
  posts: [],
  categories: new Map(),
  authors: new Map(),
};

const editUrl = (id) => `${SITE_BASE}admin/post-edit.html?id=${encodeURIComponent(id)}`;

/* ---------------- URL state ---------------- */

function readFilters() {
  const p = new URLSearchParams(window.location.search);
  return {
    status: STATUSES.some((s) => s.key === p.get("status")) ? p.get("status") : "",
    category: p.get("category") || "",
    q: p.get("q") || "",
    page: Math.max(1, parseInt(p.get("page"), 10) || 1),
  };
}

function hrefFor(f) {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.category) p.set("category", f.category);
  if (f.q) p.set("q", f.q);
  if (f.page > 1) p.set("page", String(f.page));
  const qs = p.toString();
  return `${SITE_BASE}admin/posts.html${qs ? `?${qs}` : ""}`;
}

function update(changes, { push = true } = {}) {
  const next = { ...readFilters(), ...changes };
  const url = hrefFor(next);
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
  render();
}

/* ---------------- Helpers ---------------- */

const newestFirst = (a, b) =>
  new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);

function dateLine(post) {
  if (post.status === "published" && post.published_at) {
    return `Published ${formatDate(post.published_at)}`;
  }
  if (post.status === "scheduled" && post.scheduled_at) {
    return `For ${formatDate(post.scheduled_at, { dateStyle: "medium", timeStyle: "short" })}`;
  }
  return `Edited ${formatDate(post.updated_at || post.created_at)}`;
}

function applyFilters(f) {
  const q = f.q.trim().toLowerCase();
  return state.posts.filter(
    (p) =>
      (!f.status || p.status === f.status) &&
      (!f.category || p.category_id === f.category) &&
      (!q || (p.title || "").toLowerCase().includes(q)),
  );
}

/* ---------------- Rendering ---------------- */

function renderTabs(active) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s.key, 0]));
  counts[""] = state.posts.length;
  state.posts.forEach((p) => {
    if (p.status in counts) counts[p.status] += 1;
  });

  els.tabs.innerHTML = `
    <ul class="status-tabs__list">
      ${STATUSES.map(
        (s) => `
        <li><a class="status-tabs__tab" href="${escapeHtml(hrefFor({ ...readFilters(), status: s.key, page: 1 }))}"
          data-status="${s.key}" ${s.key === active ? 'aria-current="page"' : ""}>
          ${s.label} <span class="status-tabs__count">${counts[s.key]}</span>
        </a></li>`,
      ).join("")}
    </ul>`;
}

function rowHtml(post) {
  const category = state.categories.get(post.category_id);
  const author = state.authors.get(post.author_id);
  const isLive = post.status === "published";

  return `
    <tr data-id="${escapeHtml(post.id)}">
      <td class="cell-title" data-label="Title">
        <a class="cell-title__link" href="${editUrl(post.id)}">${escapeHtml(post.title || "Untitled post")}</a>
        ${post.featured ? '<span class="featured-mark" title="Featured on the homepage">Featured</span>' : ""}
      </td>
      <td data-label="Status">${statusTag(post.status)}</td>
      <td data-label="Category">${escapeHtml(category?.name || "—")}</td>
      <td data-label="Author">${escapeHtml(author?.name || "—")}</td>
      <td data-label="Date" class="cell-date">${escapeHtml(dateLine(post))}</td>
      <td class="cell-actions">
        <a class="link-button" href="${editUrl(post.id)}">Edit</a>
        ${isLive ? `<a class="link-button" href="${escapeHtml(urls.post(post.slug))}" target="_blank" rel="noopener">View</a>` : ""}
        <button class="link-button link-button--danger" type="button" data-delete="${escapeHtml(post.id)}">Delete</button>
      </td>
    </tr>`;
}

function render() {
  const f = readFilters();
  renderTabs(f.status);
  els.category.value = f.category;
  if (document.activeElement !== els.q) els.q.value = f.q;

  if (!state.posts.length) {
    els.count.textContent = "";
    els.pagination.innerHTML = "";
    els.list.innerHTML = `
      <div class="empty-block">
        <p>No posts yet. Your first post will appear on the website once you publish it.</p>
        <a class="button" href="${SITE_BASE}admin/post-edit.html">Write the first post</a>
      </div>`;
    return;
  }

  const filtered = applyFilters(f);
  if (!filtered.length) {
    els.count.textContent = "";
    els.pagination.innerHTML = "";
    els.list.innerHTML = `
      <div class="empty-block">
        <p>No posts match these filters.</p>
        <a class="button button--quiet" href="${SITE_BASE}admin/posts.html" data-clear>Clear filters</a>
      </div>`;
    return;
  }

  const result = adapters.paginate(filtered, f.page, PER_PAGE);
  if (result.page !== f.page) history.replaceState(null, "", hrefFor({ ...f, page: result.page }));

  els.count.textContent =
    result.total_pages > 1
      ? `Showing ${(result.page - 1) * PER_PAGE + 1}–${(result.page - 1) * PER_PAGE + result.results.length} of ${result.total} posts`
      : `${result.total} ${result.total === 1 ? "post" : "posts"}`;

  els.list.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Category</th>
            <th scope="col">Author</th>
            <th scope="col">Date</th>
            <th scope="col"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>${result.results.map(rowHtml).join("")}</tbody>
      </table>
    </div>`;

  els.pagination.innerHTML = paginationHtml(result, (n) => hrefFor({ ...f, page: n }));
}

/* ---------------- Delete ---------------- */

async function deletePost(id, button) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return;

  const ok = await confirmDialog({
    title: "Delete this post?",
    message: `“${post.title || "Untitled post"}” will be removed from the website and can't be recovered.`,
    confirmLabel: "Delete post",
    danger: true,
  });
  if (!ok) return;

  button.disabled = true;
  button.textContent = "Deleting…";
  try {
    await admin.posts.remove(id);
    state.posts = state.posts.filter((p) => p.id !== id);
    render();
    toast("Post deleted");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Delete";
    toast(error.message || "Couldn't delete the post.", "error");
  }
}

/* ---------------- Events ---------------- */

els.tabs.addEventListener("click", (e) => {
  const tab = e.target.closest("a[data-status]");
  if (!tab || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  update({ status: tab.dataset.status, page: 1 });
});

els.category.addEventListener("change", () => update({ category: els.category.value, page: 1 }));

let qTimer;
els.q.addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => update({ q: els.q.value.trim(), page: 1 }, { push: false }), 200);
});

els.list.addEventListener("click", (e) => {
  const del = e.target.closest("[data-delete]");
  if (del) {
    deletePost(del.dataset.delete, del);
    return;
  }
  const clear = e.target.closest("[data-clear]");
  if (clear) {
    e.preventDefault();
    els.q.value = "";
    update({ status: "", category: "", q: "", page: 1 });
  }
});

els.pagination.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-page]");
  if (!link || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  update({ page: Number(link.dataset.page) });
  document.querySelector(".admin-head").scrollIntoView({ behavior: "smooth" });
});

window.addEventListener("popstate", render);

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.list, { lines: 6 });
  try {
    const [posts, categories, authors] = await Promise.all([
      admin.posts.list(),
      admin.categories.list().catch(() => []),
      admin.authors.list().catch(() => []),
    ]);
    stop();
    state.posts = [...posts].sort(newestFirst);
    state.categories = new Map(categories.map((c) => [c.id, c]));
    state.authors = new Map(authors.map((a) => [a.id, a]));

    els.category.innerHTML =
      `<option value="">All categories</option>` +
      [...categories]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
        .join("");

    render();
  } catch (error) {
    stop();
    showError(els.list, error, load);
  }
}

const user = await requireAdmin();
renderAdminLayout(user);
setAdminTitle("Posts");
showFlash();
load();
