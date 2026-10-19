/**
 * Orlu Zone API client
 * Framework-free ES module. Import it with:
 *   <script type="module"> import { api } from "./api.js"; </script>
 *
 * Based on the "Frontend API Integration Contract" (Oct 2026).
 * Temporary workarounds for backend gaps live in the `adapters` section at
 * the bottom. When the backend adds a fix, change the adapter only.
 */

import { API_ORIGIN, API_PREFIX } from "./config.js";

// Kept as exports for older imports; the values live in js/config.js.
export const BASE_URL = API_ORIGIN;
const PREFIX = API_PREFIX;

// Render can take 30–60s to wake from idle, so use a generous timeout.
const DEFAULT_TIMEOUT_MS = 70_000;

/* ------------------------------------------------------------------ */
/* Token storage                                                       */
/* ------------------------------------------------------------------ */

// By default the token lives in sessionStorage and is cleared when the tab
// closes. "Keep me signed in" on the login page puts it in localStorage
// instead, so it survives closing the browser (until the token expires).
const TOKEN_KEY = "orlu_access_token";

function store(kind) {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // storage blocked (private mode, strict settings)
  }
}

export const auth = {
  getToken() {
    try {
      return store("session")?.getItem(TOKEN_KEY) || store("local")?.getItem(TOKEN_KEY) || null;
    } catch {
      return null;
    }
  },
  /** @param {string} token  @param {{remember?: boolean}} [opts] */
  setToken(token, { remember = false } = {}) {
    this.clearToken();
    try {
      store(remember ? "local" : "session")?.setItem(TOKEN_KEY, token);
    } catch {
      /* storage blocked */
    }
  },
  clearToken() {
    try {
      store("session")?.removeItem(TOKEN_KEY);
      store("local")?.removeItem(TOKEN_KEY);
    } catch {
      /* storage blocked */
    }
  },
  isLoggedIn() {
    return Boolean(this.getToken());
  },
};

// Called on any 401. Override in your admin pages, e.g.:
//   setOnUnauthorized(() => (window.location.href = "/admin/login.html"));
let onUnauthorized = () => {};
export function setOnUnauthorized(fn) {
  onUnauthorized = fn;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  /**
   * @param {number} status   HTTP status (0 for network/timeout errors)
   * @param {string} message  Human-readable message
   * @param {any}    body     Parsed error body, if any
   */
  constructor(status, message, body = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /**
   * FastAPI 422s return { detail: [{ loc, msg, type }] }.
   * Returns { fieldName: "message" } for showing errors next to form fields.
   */
  get fieldErrors() {
    const detail = this.body?.detail;
    if (!Array.isArray(detail)) return {};
    const out = {};
    for (const item of detail) {
      const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : "form";
      out[field] = item.msg;
    }
    return out;
  }
}

function messageFromBody(status, body) {
  if (body && typeof body.detail === "string") return body.detail;
  if (body && Array.isArray(body.detail)) return body.detail.map((d) => d.msg).join("; ");
  if (status === 401) return "Your session has expired. Please log in again.";
  if (status === 404) return "Not found.";
  if (status >= 500) return "The server had a problem. Please try again.";
  return `Request failed (${status}).`;
}

/* ------------------------------------------------------------------ */
/* Core request                                                        */
/* ------------------------------------------------------------------ */

/**
 * @param {string} path            Path after /api/v1, e.g. "/posts"
 * @param {object} [opts]
 * @param {string} [opts.method]
 * @param {object|FormData} [opts.body]
 * @param {object} [opts.query]    Query params; null/undefined/"" are skipped
 * @param {boolean} [opts.authed]  Send the bearer token
 * @param {boolean} [opts.raw]     Use the path as-is (no /api/v1), for /health
 */
export async function request(path, opts = {}) {
  const { method = "GET", body, query, authed = false, raw = false } = opts;

  const url = new URL(BASE_URL + (raw ? "" : PREFIX) + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }

  const headers = {};
  let payload;
  if (body instanceof FormData) {
    payload = body; // Browser sets the multipart Content-Type and boundary.
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  if (authed) {
    const token = auth.getToken();
    if (!token) {
      onUnauthorized();
      throw new ApiError(401, "Please log in.");
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { method, headers, body: payload, signal: controller.signal });
  } catch (err) {
    const timedOut = err.name === "AbortError";
    throw new ApiError(
      0,
      timedOut
        ? "The server is taking too long to respond. Please try again."
        : "Couldn't reach the server. Check your connection.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!response.ok) {
    if (response.status === 401 && authed) {
      auth.clearToken();
      onUnauthorized();
    }
    throw new ApiError(response.status, messageFromBody(response.status, data), data);
  }

  return data;
}

/**
 * Authenticated multipart POST with upload progress (XMLHttpRequest).
 * Same errors as request(): ApiError, and a 401 signs the admin out.
 * @param {(fraction: number) => void} [opts.onProgress]  0..1 while sending
 */
function uploadWithProgress(path, form, { onProgress } = {}) {
  const token = auth.getToken();
  if (!token) {
    onUnauthorized();
    return Promise.reject(new ApiError(401, "Please log in."));
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", BASE_URL + PREFIX + path);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.timeout = 15 * 60 * 1000; // generous: big file, slow line, sleeping server

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
    }

    xhr.addEventListener("load", () => {
      let data = null;
      if (xhr.responseText) {
        try { data = JSON.parse(xhr.responseText); } catch { data = xhr.responseText; }
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (xhr.status === 401) {
        auth.clearToken();
        onUnauthorized();
      }
      reject(new ApiError(xhr.status, messageFromBody(xhr.status, data), data));
    });
    xhr.addEventListener("error", () =>
      reject(new ApiError(0, "Couldn't reach the server. Check your connection.")),
    );
    xhr.addEventListener("timeout", () =>
      reject(new ApiError(0, "The upload took too long. Please try again.")),
    );
    xhr.send(form);
  });
}

/** Like request(), but returns null on 404 instead of throwing. */
async function getOrNull(path, opts) {
  try {
    return await request(path, opts);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

const enc = encodeURIComponent;

/* ------------------------------------------------------------------ */
/* Public endpoints                                                    */
/* ------------------------------------------------------------------ */

/*
 * Contract §18.7: the backend hasn't confirmed whether public endpoints can
 * return scheduled posts or draft events. Filter them on the website side so
 * unfinished content never shows. If the API already excludes them, this
 * changes nothing. Records without a status are kept.
 */
const isPublicPost = (p) => p && (!p.status || p.status === "published");
const isPublicEvent = (e) => e && (!e.status || e.status === "published" || e.status === "cancelled");
const onlyPublic = (list, test) => (Array.isArray(list) ? list.filter(test) : []);

export const api = {
  // Site and homepage
  getSite: () => request("/site"),
  getHome: async () => {
    const home = (await request("/home")) || {};
    return {
      ...home,
      featured_posts: onlyPublic(home.featured_posts, isPublicPost),
      latest_posts: onlyPublic(home.latest_posts, isPublicPost),
      upcoming_events: onlyPublic(home.upcoming_events, isPublicEvent),
    };
  },

  // Posts (drafts return 404, so getPost returns null; scheduled ones too)
  listPosts: async () => onlyPublic(await request("/posts"), isPublicPost),
  getPost: async (slug) => {
    const post = await getOrNull(`/posts/${enc(slug)}`);
    return isPublicPost(post) ? post : null;
  },

  // Events (cancelled events stay visible, marked as cancelled)
  listEvents: async () => onlyPublic(await request("/events"), isPublicEvent),
  getEvent: async (slug) => {
    const event = await getOrNull(`/events/${enc(slug)}`);
    return isPublicEvent(event) ? event : null;
  },

  // Categories
  listCategories: () => request("/categories"),
  getCategory: (slug) => getOrNull(`/categories/${enc(slug)}`),

  // Community profiles (published only, already in the admin's order).
  // A badly formed id returns 422 rather than 404; both mean "not found".
  listProfiles: () => request("/community-profiles"),
  getProfile: async (id) => {
    try {
      return await request(`/community-profiles/${enc(id)}`);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 422)) return null;
      throw err;
    }
  },

  // Documents (published PDFs only, newest first)
  listDocuments: () => request("/documents"),

  // Gallery and pages
  getGallery: () => request("/gallery"),
  getPage: (slug) => getOrNull(`/pages/${enc(slug)}`), // "about", "contact"

  // Search
  search: (q, { page = 1, limit = 20 } = {}) =>
    request("/search", { query: { q: q.trim(), page, limit } }),
  suggest: (q, { limit = 8 } = {}) =>
    request("/search/suggestions", { query: { q: q.trim(), limit } }),

  // Health (outside /api/v1). Handy for waking the server early.
  health: () => request("/health", { raw: true }),
};

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const session = {
  /** @param {{remember?: boolean}} [opts]  keep the token after the browser closes */
  async login(email, password, { remember = false } = {}) {
    const data = await request("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    if (!data?.access_token) throw new ApiError(500, "The server didn't return a sign-in token.");
    auth.setToken(data.access_token, { remember });
    return data;
  },
  me: () => request("/auth/me", { authed: true }),
  // No logout endpoint exists yet, so this only clears the local token.
  logout() {
    auth.clearToken();
  },
};

/* ------------------------------------------------------------------ */
/* Admin endpoints (all require a token)                               */
/* ------------------------------------------------------------------ */

function crud(resource) {
  const base = `/admin/${resource}`;
  return {
    list: () => request(base, { authed: true }),
    get: (id) => request(`${base}/${enc(id)}`, { authed: true }),
    create: (data) => request(base, { method: "POST", body: data, authed: true }),
    update: (id, data) => request(`${base}/${enc(id)}`, { method: "PATCH", body: data, authed: true }),
    remove: (id) => request(`${base}/${enc(id)}`, { method: "DELETE", authed: true }),
  };
}

export const admin = {
  categories: crud("categories"),
  authors: crud("authors"),

  posts: {
    ...crud("posts"),
    getMedia: (id) => request(`/admin/posts/${enc(id)}/media`, { authed: true }),
    // Replaces the WHOLE list. Send every media id you want to keep.
    setMedia: (id, mediaIds) =>
      request(`/admin/posts/${enc(id)}/media`, {
        method: "PUT",
        body: { media_ids: mediaIds },
        authed: true,
      }),
  },

  events: {
    ...crud("events"),
    getMedia: (id) => request(`/admin/events/${enc(id)}/media`, { authed: true }),
    setMedia: (id, mediaIds) =>
      request(`/admin/events/${enc(id)}/media`, {
        method: "PUT",
        body: { media_ids: mediaIds },
        authed: true,
      }),
  },

  media: {
    list: () => request("/admin/media", { authed: true }),
    get: (id) => request(`/admin/media/${enc(id)}`, { authed: true }),
    remove: (id) => request(`/admin/media/${enc(id)}`, { method: "DELETE", authed: true }),
    /**
     * @param {File} file
     * @param {{caption?: string, alt_text?: string}} [meta]
     */
    upload(file, { caption, alt_text } = {}) {
      const problem = adapters.validateUpload(file);
      if (problem) return Promise.reject(new ApiError(422, problem));
      const form = new FormData();
      form.append("file", file);
      if (caption) form.append("caption", caption);
      if (alt_text) form.append("alt_text", alt_text);
      return request("/admin/media", { method: "POST", body: form, authed: true });
    },
  },

  gallery: {
    list: () => request("/admin/gallery", { authed: true }),
    add: (mediaId) => request("/admin/gallery", { method: "POST", body: { media_id: mediaId }, authed: true }),
    // Removes from the gallery only; the media record itself stays.
    remove: (mediaId) => request(`/admin/gallery/${enc(mediaId)}`, { method: "DELETE", authed: true }),
    reorder: (mediaIds) =>
      request("/admin/gallery/order", { method: "PATCH", body: { media_ids: mediaIds }, authed: true }),
  },

  pages: {
    get: (slug) => request(`/admin/pages/${enc(slug)}`, { authed: true }),
    // Both title and content are required.
    update: (slug, { title, content }) =>
      request(`/admin/pages/${enc(slug)}`, { method: "PATCH", body: { title, content }, authed: true }),
  },

  profiles: {
    // Every profile, published or not, with is_published and display_order.
    ...crud("community-profiles"),
    // Must contain EVERY profile id exactly once, or the server answers 422.
    reorder: (profileIds) =>
      request("/admin/community-profiles/order", {
        method: "PATCH",
        body: { profile_ids: profileIds },
        authed: true,
      }),
  },

  documents: {
    // Every document, any status (draft, published, withdrawn), newest first.
    list: () => request("/admin/documents", { authed: true }),
    get: (id) => request(`/admin/documents/${enc(id)}`, { authed: true }),
    /**
     * Upload a PDF. New documents start as drafts.
     * @param {File} file  @param {{title: string, description?: string}} meta
     */
    upload(file, { title, description, onProgress } = {}) {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title);
      if (description) form.append("description", description);
      // XHR rather than fetch: shows upload progress, and a 20 MB PDF on a
      // slow connection can take longer than the normal 70s limit.
      return uploadWithProgress("/admin/documents", form, { onProgress });
    },
    // Title/description edits. Send only what changed.
    update: (id, data) => request(`/admin/documents/${enc(id)}`, { method: "PATCH", body: data, authed: true }),
    publish: (id) => request(`/admin/documents/${enc(id)}/publish`, { method: "POST", authed: true }),
    withdraw: (id) => request(`/admin/documents/${enc(id)}/withdraw`, { method: "POST", authed: true }),
    // There is no permanent-delete endpoint.
  },

  site: {
    get: () => request("/admin/site", { authed: true }),
    // community_name is required.
    update: (data) => request("/admin/site", { method: "PATCH", body: data, authed: true }),
  },
};

/* ------------------------------------------------------------------ */
/* Document downloads                                                  */
/* ------------------------------------------------------------------ */

/**
 * Absolute download link for a public document. The API returns a path
 * like "/api/v1/documents/{id}/download"; join it to the API origin.
 * Only same-API http(s) links are allowed through.
 */
export function documentDownloadUrl(doc) {
  // Admin responses have no download_url; the public path is fixed by the contract.
  const raw = doc?.download_url || (doc?.id ? `${PREFIX}/documents/${encodeURIComponent(doc.id)}/download` : null);
  if (!raw) return null;
  try {
    const url = new URL(raw, API_ORIGIN);
    return url.origin === new URL(API_ORIGIN).origin ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Download a document's PDF without leaving the page.
 * Resolves "downloaded", "missing" (404: withdrawn or unpublished since the
 * list loaded), or throws ApiError for other failures. If the browser blocks
 * reading the file (e.g. CORS), resolves "fallback" so the caller can just
 * open the link instead.
 */
/**
 * Fetch a document's PDF. Resolves { blob, filename }, or "missing" (404:
 * withdrawn or unpublished since the list loaded), or "fallback" when the
 * browser can't read the file (e.g. CORS). Throws ApiError for other failures.
 */
export async function fetchDocumentFile(doc, { fallbackName = "document" } = {}) {
  const href = documentDownloadUrl(doc);
  if (!href) return "missing";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(href, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new ApiError(0, "The server is taking too long to respond. Please try again.");
    }
    return "fallback";
  }
  clearTimeout(timer);

  if (response.status === 404) return "missing";
  if (!response.ok) {
    const message =
      response.status === 503
        ? "Documents are temporarily unavailable. Please try again shortly."
        : `The document couldn't be loaded (${response.status}). Please try again.`;
    throw new ApiError(response.status, message);
  }

  // Filename from Content-Disposition when the server exposes it, else from the title.
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
  let filename = match ? decodeURIComponent(match[1] || match[2]) : "";
  if (!filename) {
    const safe = String(fallbackName).replace(/[^\w\s.-]+/g, "").trim().replace(/\s+/g, "-") || "document";
    filename = /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
  }

  // Label it as a PDF so the browser's viewer opens it, whatever the server said.
  const raw = await response.blob();
  const blob = raw.type === "application/pdf" ? raw : new Blob([raw], { type: "application/pdf" });
  return { blob, filename };
}

/** Save a fetched PDF to the visitor's device. */
export function saveDocumentFile({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Download a document's PDF without leaving the page.
 * Resolves "downloaded", "missing" or "fallback" (see fetchDocumentFile).
 */
export async function downloadDocument(doc, opts = {}) {
  const file = await fetchDocumentFile(doc, opts);
  if (typeof file === "string") return file;
  saveDocumentFile(file);
  return "downloaded";
}

/* ------------------------------------------------------------------ */
/* Adapters: temporary workarounds for backend gaps                    */
/* Swap the inside of each function once the backend ships the fix.    */
/* ------------------------------------------------------------------ */

let categoryCache = null;

export const adapters = {
  // GAP: SiteResponse has no logo_url. Replace with site.logo_url later.
  LOGO_FALLBACK: "/assets/logo.png",
  logoUrl(site) {
    return site?.logo_url || this.LOGO_FALLBACK;
  },

  // GAP: posts only carry category_id. Later: post.category.name.
  async categoryMap() {
    if (!categoryCache) {
      const list = await api.listCategories();
      categoryCache = new Map(list.map((c) => [c.id, c]));
    }
    return categoryCache;
  },
  async categoryFor(post) {
    if (post?.category) return post.category; // already embedded (future)
    const map = await this.categoryMap();
    return map.get(post?.category_id) || null;
  },

  // GAP: posts only carry author_id and there's no public authors endpoint.
  // Returns null until the backend embeds post.author.
  authorFor(post) {
    return post?.author || null;
  },

  // GAP: no ?category= filter. Later: request("/posts", { query: { category: slug } }).
  async postsInCategory(slug) {
    const [category, posts] = await Promise.all([api.getCategory(slug), api.listPosts()]);
    if (!category) return { category: null, posts: [] };
    return { category, posts: posts.filter((p) => p.category_id === category.id) };
  },

  // GAP: no ?when= filter on events.
  splitEvents(events, now = new Date()) {
    const upcoming = [];
    const past = [];
    for (const e of events) {
      const end = new Date(e.end_at || e.start_at);
      (end >= now ? upcoming : past).push(e);
    }
    upcoming.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    past.sort((a, b) => new Date(b.start_at) - new Date(a.start_at));
    return { upcoming, past };
  },

  // GAP: list endpoints aren't paginated. Same envelope shape as /search,
  // so the UI won't change when server pagination arrives.
  paginate(items, page = 1, limit = 10) {
    const total = items.length;
    const total_pages = Math.max(1, Math.ceil(total / limit));
    const current = Math.min(Math.max(1, page), total_pages);
    const start = (current - 1) * limit;
    return { results: items.slice(start, start + limit), page: current, limit, total, total_pages };
  },

  // GAP: upload limits not documented. Assumed values; update when known.
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  ALLOWED_TYPES: ["image/jpeg", "image/png", "image/webp"],
  validateUpload(file) {
    if (!file) return "Choose a file to upload.";
    if (!this.ALLOWED_TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP image.";
    if (file.size > this.MAX_UPLOAD_BYTES) return "Images must be 5 MB or smaller.";
    return null;
  },
};

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

// Timestamps are assumed UTC; shown in Lagos time (WAT).
export function formatDate(iso, opts = {}) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    ...opts,
  }).format(new Date(iso));
}

export function formatDateTime(iso) {
  return formatDate(iso, { dateStyle: "medium", timeStyle: "short" });
}
