/**
 * Shared UI helpers for the public site.
 * Location: js/ui.js
 *
 * Every public page calls initShell() once. It renders the header and
 * footer from the site settings so contact details live in one place.
 */

import { api, adapters, ApiError, formatDate } from "./api.js";
import { SOCIAL, socialLinks, handleFrom } from "./social.js";
import { initEmailChooser } from "./email-chooser.js";

/* ------------------------------------------------------------------ */
/* Safety                                                              */
/* ------------------------------------------------------------------ */

/** Escape text from the API before putting it into innerHTML. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Only allow http(s) and site-relative URLs into href/src attributes. */
export function safeUrl(url) {
  if (!url) return "";
  const s = String(url).trim();
  if (s.startsWith("/") || /^https?:\/\//i.test(s)) return escapeHtml(s);
  return "";
}

/* ------------------------------------------------------------------ */
/* URLs and params                                                     */
/* ------------------------------------------------------------------ */

export const urls = {
  home: () => "/index.html",
  posts: () => "/posts.html",
  post: (slug) => `/post.html?slug=${encodeURIComponent(slug)}`,
  events: () => "/events.html",
  event: (slug) => `/event.html?slug=${encodeURIComponent(slug)}`,
  // Category pages are the news list filtered by category.
  category: (slug) => `/posts.html?category=${encodeURIComponent(slug)}`,
  gallery: () => "/gallery.html",
  about: () => "/about.html",
  profiles: () => "/profiles.html",
  documents: () => "/documents.html",
  contact: () => "/contact.html",
  search: (q) => `/search.html?q=${encodeURIComponent(q)}`,
};

export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

// The public site is green, so it uses the dark placeholder; the admin keeps the light one.
export const PLACEHOLDER_IMAGE = document.body?.classList.contains("admin")
  ? "/assets/images/placeholder.svg"
  : "/assets/images/placeholder-dark.svg";

/** Featured image for a post or event, with a placeholder fallback. */
export function featuredImage(item) {
  return item?.featured_media_url || PLACEHOLDER_IMAGE;
}

/** Plain-text summary for cards: excerpt, else the start of the content. */
export function summary(item, max = 180) {
  const text = item?.excerpt || stripTags(item?.content || item?.description || "");
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function stripTags(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* Shared cards: event rows and post entries                           */
/* ------------------------------------------------------------------ */

/**
 * Human-readable time for an event, in Lagos time.
 *   same day:  "Sunday, 15 November 2026, 11:00 to 14:00"
 *   multi-day: "Sunday, 15 November to Tuesday, 17 November 2026"
 *   no end:    "Sunday, 15 November 2026, 11:00"
 */
export function eventWhen(event, { withYear = true } = {}) {
  if (!event?.start_at) return "";
  const date = (iso, year = withYear) =>
    formatDate(iso, {
      dateStyle: undefined,
      weekday: "long",
      day: "numeric",
      month: "long",
      ...(year ? { year: "numeric" } : {}),
    });
  const time = (iso) => formatDate(iso, { dateStyle: undefined, hour: "numeric", minute: "2-digit" });

  if (!event.end_at) return `${date(event.start_at)}, ${time(event.start_at)}`;
  if (date(event.start_at) === date(event.end_at)) {
    return `${date(event.start_at)}, ${time(event.start_at)} to ${time(event.end_at)}`;
  }
  return `${date(event.start_at, false)} to ${date(event.end_at)}`;
}

export function eventRow(event) {
  const day = formatDate(event.start_at, { day: "numeric", dateStyle: undefined });
  const month = formatDate(event.start_at, { month: "short", dateStyle: undefined });
  const when = formatDate(event.start_at, {
    dateStyle: undefined,
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  const cancelled = event.status === "cancelled";

  return `
    <article class="event-row${cancelled ? " is-cancelled" : ""}">
      <time class="date-badge" datetime="${escapeHtml(event.start_at)}">
        <span class="date-badge__day">${escapeHtml(day)}</span>
        <span class="date-badge__month">${escapeHtml(month)}</span>
      </time>
      <div>
        <h3 class="event-row__title">
          <a href="${urls.event(event.slug)}">${escapeHtml(event.title)}</a>
        </h3>
        <p class="event-row__details">
          ${cancelled ? '<span class="event-row__status">Cancelled</span>' : `<span>${escapeHtml(when)}</span>`}
          ${event.location ? `<span>${escapeHtml(event.location)}</span>` : ""}
        </p>
      </div>
    </article>`;
}

export function postEntry(post, category, { headingLevel = 3, summaryLength = 160, showSummary = true } = {}) {
  const h = `h${headingLevel}`;
  const date = post.published_at || post.created_at;
  return `
    <article class="entry">
      <a class="entry__media" href="${urls.post(post.slug)}" tabindex="-1" aria-hidden="true">
        <img src="${safeUrl(featuredImage(post))}" alt="" loading="lazy">
      </a>
      <p class="entry__meta">
        ${category ? `<a class="entry__category" href="${urls.category(category.slug)}">${escapeHtml(category.name)}</a>` : ""}
        ${date ? `<time datetime="${escapeHtml(date)}">${escapeHtml(formatDate(date))}</time>` : ""}
      </p>
      <${h} class="entry__title"><a href="${urls.post(post.slug)}">${escapeHtml(post.title)}</a></${h}>
      ${showSummary ? `<p class="entry__summary">${escapeHtml(summary(post, summaryLength))}</p>` : ""}
    </article>`;
}

export async function categoriesFor(posts) {
  // GAP workaround: posts carry only category_id. If the lookup fails,
  // posts still render, just without a category label.
  try {
    return await Promise.all(posts.map((p) => adapters.categoryFor(p)));
  } catch {
    return posts.map(() => null);
  }
}

/* ------------------------------------------------------------------ */
/* Sharing                                                             */
/* ------------------------------------------------------------------ */

/** WhatsApp share and copy-link buttons for the current page. */
export function shareHtml(title) {
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${title} ${window.location.href}`)}`;
  return `
    <div class="share">
      <a class="share__button" href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener">Share on WhatsApp</a>
      <button class="share__button" type="button" data-copy-link>Copy link</button>
    </div>`;
}

/** Wire up the copy-link button rendered by shareHtml(). */
export function attachShare(root) {
  const copy = root.querySelector("[data-copy-link]");
  copy?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copy.textContent = "Link copied";
    } catch {
      copy.textContent = "Copy failed";
    }
    setTimeout(() => (copy.textContent = "Copy link"), 2500);
  });
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

/**
 * Page links for a { page, total_pages } envelope (the same shape as
 * /search and adapters.paginate). `hrefFor(n)` builds each page's URL.
 * Shows first, last, and two pages either side of the current one.
 */
export function paginationHtml({ page, total_pages }, hrefFor) {
  if (!total_pages || total_pages < 2) return "";
  const pages = new Set([1, total_pages]);
  for (let n = page - 2; n <= page + 2; n++) if (n > 1 && n < total_pages) pages.add(n);
  const sorted = [...pages].sort((a, b) => a - b);

  const items = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) items.push('<li class="pagination__gap" aria-hidden="true">…</li>');
    items.push(
      n === page
        ? `<li><span class="pagination__link is-current" aria-current="page">${n}</span></li>`
        : `<li><a class="pagination__link" href="${escapeHtml(hrefFor(n))}" data-page="${n}" aria-label="Page ${n}">${n}</a></li>`,
    );
  });

  const prev = page > 1
    ? `<a class="pagination__step" href="${escapeHtml(hrefFor(page - 1))}" data-page="${page - 1}">Previous</a>`
    : `<span class="pagination__step is-disabled" aria-hidden="true">Previous</span>`;
  const next = page < total_pages
    ? `<a class="pagination__step" href="${escapeHtml(hrefFor(page + 1))}" data-page="${page + 1}">Next</a>`
    : `<span class="pagination__step is-disabled" aria-hidden="true">Next</span>`;

  return `${prev}<ul class="pagination__list">${items.join("")}</ul>${next}`;
}

/* ------------------------------------------------------------------ */
/* Loading, empty and error states                                     */
/* ------------------------------------------------------------------ */

/**
 * Show a loading state in a container. After a few seconds the message
 * explains the Render cold start, so people don't think the site is broken.
 * Returns a function that stops the timer.
 */
export function showLoading(container, { lines = 3 } = {}) {
  container.setAttribute("aria-busy", "true");
  container.innerHTML = `
    <div class="state state--loading" role="status">
      ${Array.from({ length: lines }, () => '<span class="skeleton"></span>').join("")}
      <p class="state__note" hidden>Waking up the server. This can take up to a minute the first time.</p>
    </div>`;
  const note = container.querySelector(".state__note");
  const timer = setTimeout(() => note && (note.hidden = false), 4000);
  return () => {
    clearTimeout(timer);
    container.removeAttribute("aria-busy");
  };
}

export function showEmpty(container, message, action = null) {
  container.innerHTML = `
    <div class="state state--empty">
      <p>${escapeHtml(message)}</p>
      ${action ? `<a class="button button--quiet" href="${safeUrl(action.href)}">${escapeHtml(action.label)}</a>` : ""}
    </div>`;
}

export function showError(container, error, onRetry) {
  const message =
    error instanceof ApiError ? error.message : "Something went wrong loading this section.";
  container.innerHTML = `
    <div class="state state--error" role="alert">
      <p>${escapeHtml(message)}</p>
      ${onRetry ? '<button type="button" class="button button--quiet" data-retry>Try again</button>' : ""}
    </div>`;
  container.querySelector("[data-retry]")?.addEventListener("click", onRetry);
}

/* ------------------------------------------------------------------ */
/* Header and footer                                                   */
/* ------------------------------------------------------------------ */

const NAV = [
  { label: "Home", note: "Start here", href: urls.home(), match: ["/", "/index.html"] },
  { label: "News", note: "Announcements and stories", href: urls.posts(), match: ["/posts.html", "/post.html", "/category.html"] },
  { label: "Events", note: "Meetings, festivals and gatherings", href: urls.events(), match: ["/events.html", "/event.html"] },
  { label: "Gallery", note: "Photos from home", href: urls.gallery(), match: ["/gallery.html"] },
  { label: "About", note: "Orlu Zone, the Compendium and investing", href: urls.about(), match: ["/about.html"] },
  { label: "Leadership", note: "Profiles of community leaders", href: urls.profiles(), match: ["/profiles.html"] },
  { label: "Documents", note: "Forms and reports to download", href: urls.documents(), match: ["/documents.html"] },
  { label: "Contact", note: "Ask a question or share news", href: urls.contact(), match: ["/contact.html"] },
];

/*
 * Which menu link is the current page. The live site (Cloudflare) serves
 * pages without ".html" ("/gallery" instead of "/gallery.html") and may add
 * a trailing slash, so both sides are tidied the same way before comparing:
 * "/gallery.html", "/gallery" and "/gallery/" all become "/gallery", and
 * "/", "/index" and "/index.html" all become "/".
 */
export function cleanPath(path) {
  let p = String(path || "/").toLowerCase().split(/[?#]/)[0];
  p = p.replace(/\/+$/, "") || "/";
  p = p.replace(/\.html$/, "");
  if (p === "/index") p = "/";
  return p;
}

function isCurrent(item, path) {
  return item.match.some((m) => cleanPath(m) === path);
}

const MENU_EXTRA = [
  { label: "Invest at home", href: "/about.html#invest" },
  { label: "Who's Who categories", href: "/index.html#whoswho-title" },
];

let searchListenerAdded = false;

function renderHeader(site) {
  const header = document.querySelector("[data-site-header]");
  if (!header) return;
  const path = cleanPath(window.location.pathname);
  const name = site?.community_name || "Orlu Land Compendium";
  const currentQ = path === "/search" ? getParam("q") || "" : "";

  // The header renders twice (defaults, then real site settings). Remember
  // what the person was doing so the second render doesn't undo it.
  const before = header.querySelector("#site-search");
  const prev = before
    ? {
        value: before.value,
        focused: document.activeElement === before,
        open: header.classList.contains("is-searching"),
        menuOpen: header.querySelector(".drawer")?.open || false,
      }
    : null;

  header.innerHTML = `
    <div class="header__inner">
      <a class="brand" href="${urls.home()}">
        <img class="brand__logo" src="${safeUrl(adapters.logoUrl(site))}" alt="" width="46" height="46">
        <span class="brand__name">${escapeHtml(name)}</span>
      </a>

      <nav class="nav" aria-label="Main">
        <ul class="nav__list">
          ${NAV.map(
            (item) => `
            <li><a class="nav__link" href="${item.href}"
              ${isCurrent(item, path) ? 'aria-current="page"' : ""}>${item.label}</a></li>`,
          ).join("")}
        </ul>
      </nav>

      <div class="header__actions">
        <button class="search-toggle" type="button" aria-expanded="false" aria-controls="site-search-form">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/>
            <path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
          <span class="search-toggle__label">Search</span>
        </button>
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-drawer" aria-haspopup="dialog">
          <span class="nav-toggle__bars" aria-hidden="true"></span>
          <span class="nav-toggle__label">Menu</span>
        </button>
      </div>

      <form class="search-box" id="site-search-form" action="/search.html" method="get" role="search">
        <label class="visually-hidden" for="site-search">Search news and events</label>
        <input id="site-search" name="q" type="search" placeholder="Search news and events"
          value="${escapeHtml(currentQ)}" autocomplete="off" required>
        <button class="search-box__submit" type="submit">Search</button>
      </form>
    </div>

    <dialog class="drawer" id="site-drawer" aria-labelledby="drawer-title">
      <div class="drawer__panel">
      <div class="drawer__head">
        <p class="drawer__title" id="drawer-title">Menu</p>
        <button class="drawer__close" type="button" data-drawer-close>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
          <span class="visually-hidden">Close menu</span>
        </button>
      </div>
      <nav class="drawer__nav" aria-label="Menu">
        <ul>
          ${NAV.map(
            (item) => `
            <li><a class="drawer__link" href="${item.href}" ${isCurrent(item, path) ? 'aria-current="page"' : ""}>
              <span class="drawer__label">${item.label}</span>
              <span class="drawer__note">${item.note}</span>
            </a></li>`,
          ).join("")}
        </ul>
      </nav>
      <ul class="drawer__extra">
        ${MENU_EXTRA.map((i) => `<li><a href="${i.href}">${i.label}</a></li>`).join("")}
      </ul>
      <p class="drawer__motto">Documenting historical greatness, legacies that inspire generations</p>
      </div>
    </dialog>`;

  const input = header.querySelector("#site-search");
  if (prev && input) {
    input.value = prev.value;
    if (prev.focused) input.focus();
  }
  import("./search-suggest.js").then((m) => m.attachSuggestions(input)).catch(() => {});

  /* ---- Search: a field that drops down under the header ---- */
  const searchToggle = header.querySelector(".search-toggle");
  const setSearchOpen = (open, { focus = true } = {}) => {
    header.classList.toggle("is-searching", open);
    searchToggle.setAttribute("aria-expanded", String(open));
    if (open && focus) input.focus();
  };
  searchToggle.addEventListener("click", () => {
    const open = !header.classList.contains("is-searching");
    setSearchOpen(open);
    if (!open) searchToggle.focus();
  });
  // These listeners outlive re-renders, so they look elements up each time.
  if (!searchListenerAdded) {
    searchListenerAdded = true;
    header.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || !header.classList.contains("is-searching")) return;
      header.classList.remove("is-searching");
      const t = header.querySelector(".search-toggle");
      t?.setAttribute("aria-expanded", "false");
      t?.focus();
    });
    document.addEventListener("click", (e) => {
      const h = document.querySelector("[data-site-header]");
      if (!h?.classList.contains("is-searching")) return;
      if (h.querySelector(".search-box")?.contains(e.target) || h.querySelector(".search-toggle")?.contains(e.target)) return;
      h.classList.remove("is-searching");
      h.querySelector(".search-toggle")?.setAttribute("aria-expanded", "false");
    });
  }
  if (prev?.open) setSearchOpen(true, { focus: prev.focused });

  /* ---- Menu: a sidebar (modal dialog) with every page ---- */
  const toggle = header.querySelector(".nav-toggle");
  const drawer = header.querySelector(".drawer");
  const openMenu = () => {
    setSearchOpen(false, { focus: false });
    drawer.showModal();
    toggle.setAttribute("aria-expanded", "true");
    (drawer.querySelector('[aria-current="page"]') || drawer.querySelector(".drawer__link"))?.focus();
  };
  const closeMenu = () => drawer.open && drawer.close();
  drawer.addEventListener("close", () => {
    toggle.setAttribute("aria-expanded", "false");
    if (toggle.isConnected) toggle.focus();
  });
  toggle.addEventListener("click", openMenu);
  drawer.querySelector("[data-drawer-close]").addEventListener("click", closeMenu);
  // A click on the dimmed area outside the panel closes it.
  drawer.addEventListener("click", (e) => {
    if (e.target === drawer) closeMenu();
  });
  // Links to a section of the current page (like #invest) should close the menu.
  drawer.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeMenu();
  });
  if (prev?.menuOpen) openMenu();
}

const FOOTER_LINKS = {
  explore: [
    { label: "Home", href: urls.home() },
    { label: "News", href: urls.posts() },
    { label: "Events", href: urls.events() },
    { label: "Gallery", href: urls.gallery() },
    { label: "Search", href: "/search.html" },
  ],
  community: [
    { label: "About Orlu Zone", href: urls.about() },
    { label: "Leadership", href: urls.profiles() },
    { label: "Documents", href: urls.documents() },
    { label: "Invest at home", href: "/about.html#invest" },
    { label: "Contact", href: urls.contact() },
  ],
};

const FOOTER_LGAS = [
  "Ideato North", "Ideato South", "Isu", "Njaba", "Nkwerre", "Nwangele",
  "Oguta", "Ohaji/Egbema", "Orlu", "Orsu", "Oru East", "Oru West",
];

const MOTTO = "Documenting historical greatness, legacies that inspire generations";

function renderFooter(site) {
  const footer = document.querySelector("[data-site-footer]");
  if (!footer) return;
  const name = site?.community_name || "Orlu Land Compendium";
  const whatsapp = site?.whatsapp_url && safeUrl(site.whatsapp_url);
  // Contact details come from Site settings in the admin; only what's filled in shows.
  const contact = [
    site?.email && `<li><span class="footer__label">Email</span><a href="mailto:${escapeHtml(site.email)}">${escapeHtml(site.email)}</a></li>`,
    site?.phone && `<li><span class="footer__label">Phone</span><a href="tel:${escapeHtml(site.phone.replace(/\s+/g, ""))}">${escapeHtml(site.phone)}</a></li>`,
    whatsapp && `<li><span class="footer__label">WhatsApp</span><a href="${whatsapp}" rel="noopener" target="_blank">Message us on WhatsApp</a></li>`,
    `<li><span class="footer__label">Address</span>${escapeHtml(site?.address || "Orlu Zone, Imo State, Nigeria")}</li>`,
  ].filter(Boolean);
  const links = (list) => list.map((i) => `<li><a href="${i.href}">${i.label}</a></li>`).join("");
  // Social media logos (WhatsApp from Site settings, the rest from js/config.js).
  const social = socialLinks(site);
  const socialRow = social.length
    ? `<ul class="footer__social" aria-label="Follow us">${social
        .map(
          ([network, url]) => `<li><a class="footer__social-link footer__social-link--${network}" href="${escapeHtml(url)}"
            target="_blank" rel="noopener" aria-label="${escapeHtml(SOCIAL[network].name)}: ${escapeHtml(handleFrom(network, url))}"
            title="${escapeHtml(SOCIAL[network].name)}">${SOCIAL[network].svg}</a></li>`,
        )
        .join("")}</ul>`
    : "";

  footer.innerHTML = `
    <svg class="footer__wave" viewBox="0 0 1200 24" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 12c50-16 100 16 150 0s100 16 150 0 100 16 150 0 100 16 150 0 100 16 150 0 100 16 150 0 100 16 150 0 100 16 150 0"/>
    </svg>

    <div class="footer__top">
      <a class="footer__brand" href="${urls.home()}">
        <img src="${safeUrl(adapters.logoUrl(site))}" alt="" width="56" height="56">
        <span>${escapeHtml(name)}</span>
      </a>
      <p class="footer__motto">${MOTTO}</p>
      <a class="button footer__cta" href="${urls.contact()}">Get in touch</a>
    </div>

    <div class="footer__inner">
      <div class="footer__about">
        <h2 class="footer__heading">About us</h2>
        <p>${escapeHtml(site?.description || "News, events and the people of Orlu Zone, for everyone at home and in the diaspora.")}</p>
        ${socialRow ? `<p class="footer__label footer__social-label">Follow us</p>${socialRow}` : ""}
      </div>
      <nav class="footer__col" aria-labelledby="footer-explore">
        <h2 class="footer__heading" id="footer-explore">Explore</h2>
        <ul class="footer__links">${links(FOOTER_LINKS.explore)}</ul>
      </nav>
      <nav class="footer__col" aria-labelledby="footer-community">
        <h2 class="footer__heading" id="footer-community">The community</h2>
        <ul class="footer__links">${links(FOOTER_LINKS.community)}</ul>
      </nav>
      <div class="footer__col">
        <h2 class="footer__heading">Contact</h2>
        <ul class="footer__contact">${contact.join("")}</ul>
      </div>
    </div>

    <div class="footer__lgas">
      <p class="visually-hidden">The 12 local government areas of Orlu Zone:</p>
      <ul>${FOOTER_LGAS.map((l) => `<li>${l}</li>`).join("")}</ul>
    </div>

    <div class="footer__bottom">
      <p>&copy; ${new Date().getFullYear()} ${escapeHtml(name)}. Imo West Senatorial District, Imo State, Nigeria.</p>
      <a class="footer__top-link" href="#main">Back to top</a>
    </div>`;
}

/** Render header and footer right away, without fetching. */
export function renderShell(site = null) {
  renderHeader(site);
  renderFooter(site);
  initEmailChooser(); // email links open a Gmail / Outlook / app / copy menu
}

/**
 * Render header and footer. Pass `site` if the page already has it
 * (the homepage gets it from /home); otherwise it is fetched.
 * A failed site fetch never blocks the page: defaults are used.
 */
export async function initShell(site = null) {
  if (!site) {
    try {
      site = await api.getSite();
    } catch {
      site = null;
    }
  }
  renderHeader(site);
  renderFooter(site);
  initEmailChooser();
  if (site?.community_name) {
    const page = document.title.split("|")[0].trim();
    document.title = page && page !== site.community_name ? `${page} | ${site.community_name}` : site.community_name;
  }
  return site;
}
