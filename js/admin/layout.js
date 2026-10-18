/**
 * Admin layout: sidebar navigation, top bar, sign out.
 * Location: js/admin/layout.js
 *
 * Each admin page has:
 *   <body class="admin admin-pending" data-admin-page="posts">
 *     <div class="admin-shell">
 *       <aside class="admin-nav" data-admin-nav></aside>
 *       <main class="admin-main" id="main"> ...page... </main>
 *     </div>
 * and its script starts with:
 *   const user = await requireAdmin();
 *   renderAdminLayout(user);
 */

import { SITE_BASE } from "../config.js";
import { api } from "../api.js";
import { escapeHtml } from "../ui.js";
import { signOut } from "./guard.js";

export const ADMIN_NAV = [
  { key: "dashboard", label: "Dashboard", href: `${SITE_BASE}admin/index.html` },
  { group: "Content" },
  { key: "posts", label: "Posts", href: `${SITE_BASE}admin/posts.html` },
  { key: "events", label: "Events", href: `${SITE_BASE}admin/events.html` },
  { key: "categories", label: "Categories", href: `${SITE_BASE}admin/categories.html` },
  { key: "authors", label: "Authors", href: `${SITE_BASE}admin/authors.html` },
  { key: "profiles", label: "Leadership", href: `${SITE_BASE}admin/profiles.html` },
  { key: "documents", label: "Documents", href: `${SITE_BASE}admin/documents.html` },
  { group: "Photos" },
  { key: "media", label: "Media library", href: `${SITE_BASE}admin/media.html` },
  { key: "gallery", label: "Gallery", href: `${SITE_BASE}admin/gallery.html` },
  { group: "Website" },
  { key: "pages", label: "Pages", href: `${SITE_BASE}admin/pages.html` },
  { key: "settings", label: "Site settings", href: `${SITE_BASE}admin/settings.html` },
];

let communityName = "Orlu Community";

export function renderAdminLayout(user) {
  const nav = document.querySelector("[data-admin-nav]");
  if (!nav) return;
  const active = document.body.dataset.adminPage;

  nav.innerHTML = `
    <div class="admin-nav__top">
      <a class="admin-brand" href="${SITE_BASE}admin/index.html">
        <img src="${SITE_BASE}assets/logo.png" alt="" width="34" height="34">
        <span class="admin-brand__text">
          <span class="admin-brand__name" data-admin-name>${escapeHtml(communityName)}</span>
          <span class="admin-brand__role">Admin</span>
        </span>
      </a>
      <button class="admin-nav__toggle" type="button" aria-expanded="false" aria-controls="admin-menu">
        <span class="nav-toggle__bars" aria-hidden="true"></span>
        <span class="visually-hidden">Menu</span>
      </button>
    </div>

    <div class="admin-nav__menu" id="admin-menu">
      <nav aria-label="Admin">
        <ul class="admin-nav__list">
          ${ADMIN_NAV.map((item) =>
            item.group
              ? `<li class="admin-nav__group" aria-hidden="true">${escapeHtml(item.group)}</li>`
              : `<li><a class="admin-nav__link" href="${item.href}" ${
                  item.key === active ? 'aria-current="page"' : ""
                }>${escapeHtml(item.label)}</a></li>`,
          ).join("")}
        </ul>
      </nav>

      <div class="admin-nav__footer">
        <a class="admin-nav__site" href="${SITE_BASE}index.html" target="_blank" rel="noopener">View the website</a>
        <p class="admin-nav__user">
          Signed in as<br><strong>${escapeHtml(user?.email || "admin")}</strong>
        </p>
        <button class="button button--outline-light admin-nav__signout" type="button" data-sign-out>Sign out</button>
      </div>
    </div>`;

  const toggle = nav.querySelector(".admin-nav__toggle");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    nav.classList.toggle("is-open", !open);
  });

  nav.querySelector("[data-sign-out]").addEventListener("click", signOut);

  // Fill in the real community name once (cached for later pages this session).
  api
    .getSite()
    .then((site) => {
      if (!site?.community_name) return;
      communityName = site.community_name;
      const el = nav.querySelector("[data-admin-name]");
      if (el) el.textContent = communityName;
    })
    .catch(() => {});

  // Banner when /auth/me couldn't be reached (see guard.js).
  if (document.body.dataset.offline) showOfflineBanner();
  else window.addEventListener("admin:offline", showOfflineBanner, { once: true });
}

function showOfflineBanner() {
  const main = document.querySelector(".admin-main");
  if (!main || main.querySelector(".admin-offline")) return;
  const banner = document.createElement("p");
  banner.className = "notice notice--warn admin-offline";
  banner.setAttribute("role", "status");
  banner.textContent = "Couldn't reach the server. Changes may not save until the connection is back.";
  main.prepend(banner);
}

/** Set the browser tab title as "<page> | Admin". */
export function setAdminTitle(page) {
  document.title = `${page} | Admin`;
}
