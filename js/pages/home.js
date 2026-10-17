/**
 * Homepage.
 * Location: js/pages/home.js   (loaded by index.html)
 *
 * One request to /home gives the site settings, featured posts,
 * latest posts and upcoming events.
 */

import { api, adapters } from "../api.js";
import {
  urls,
  eventRow,
  postEntry,
  categoriesFor,
  renderShell,
  initShell,
  showLoading,
  showEmpty,
  showError,
} from "../ui.js";
import { initHeroShow } from "../hero-show.js";

const MAX_EVENTS = 4;
const MAX_FEATURED = 4; // one lead + three on the side
const MAX_LATEST = 6;

const els = {
  heroTitle: document.querySelector("[data-hero-title]"),
  heroDescription: document.querySelector("[data-hero-description]"),
  events: document.querySelector("[data-upcoming-events]"),
  featuredSection: document.querySelector("[data-featured-section]"),
  featured: document.querySelector("[data-featured-posts]"),
  latest: document.querySelector("[data-latest-posts]"),
};

/* ---------------- Rendering ---------------- */

function renderHero(site) {
  if (site?.community_name) els.heroTitle.textContent = site.community_name;
  if (site?.description) els.heroDescription.textContent = site.description;
}

function renderEvents(events) {
  const upcoming = adapters.splitEvents(events || []).upcoming.slice(0, MAX_EVENTS);
  if (!upcoming.length) {
    showEmpty(els.events, "No events are scheduled yet. Check back soon.", {
      href: urls.events(),
      label: "See past events",
    });
    return;
  }
  els.events.innerHTML = `<div class="event-list">${upcoming.map(eventRow).join("")}</div>`;
}

async function renderFeatured(posts) {
  const list = (posts || []).slice(0, MAX_FEATURED);
  if (!list.length) {
    els.featuredSection.hidden = true;
    return [];
  }
  const cats = await categoriesFor(list);
  const [lead, ...rest] = list;
  els.featured.innerHTML = `
    <div class="featured">
      <div class="featured__lead">${postEntry(lead, cats[0], { summaryLength: 260 })}</div>
      ${rest.length ? `
        <div class="featured__side">
          ${rest.map((p, i) => postEntry(p, cats[i + 1], { showSummary: false })).join("")}
        </div>` : ""}
    </div>`;
  return list.map((p) => p.id);
}

async function renderLatest(posts, excludeIds) {
  // Don't repeat a story that is already in the featured block.
  const list = (posts || []).filter((p) => !excludeIds.includes(p.id)).slice(0, MAX_LATEST);
  if (!list.length) {
    showEmpty(els.latest, "No news has been posted yet.");
    return;
  }
  const cats = await categoriesFor(list);
  els.latest.innerHTML = `<div class="post-grid">${list.map((p, i) => postEntry(p, cats[i])).join("")}</div>`;
}

/* ---------------- Load ---------------- */

async function load() {
  els.featuredSection.hidden = false;
  const stops = [
    showLoading(els.events, { lines: 2 }),
    showLoading(els.featured),
    showLoading(els.latest),
  ];

  try {
    const home = await api.getHome();
    stops.forEach((stop) => stop());

    await initShell(home.site);
    renderHero(home.site);
    renderEvents(home.upcoming_events);
    const featuredIds = await renderFeatured(home.featured_posts);
    await renderLatest(home.latest_posts, featuredIds);
  } catch (error) {
    stops.forEach((stop) => stop());
    showError(els.events, error, load);
    els.featuredSection.hidden = true;
    els.latest.innerHTML = "";
  }
}

// Draw the header and footer immediately with defaults, then load.
renderShell();
initHeroShow(document.querySelector("[data-hero-show]"));
load();
