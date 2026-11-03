/**
 * Homepage.
 * Location: js/pages/home.js   (loaded by index.html)
 *
 * One request to /home gives the site settings (header, footer, hero).
 * "Coming up" and "Featured" are just headings with links to the Events
 * and News pages (see index.html), so no events or posts are listed here.
 */

import { api } from "../api.js";
import { renderShell, initShell } from "../ui.js";
import { initHeroShow } from "../hero-show.js";

const els = {
  heroTitle: document.querySelector("[data-hero-title]"),
  heroDescription: document.querySelector("[data-hero-description]"),
};

/* ---------------- Rendering ---------------- */

function renderHero(site) {
  // The hero title stays "Orlu Land" (set in index.html); the site name shows in the header and footer.
  if (site?.description) els.heroDescription.textContent = site.description;
}

/* ---------------- Load ---------------- */

async function load() {
  try {
    const home = await api.getHome();
    await initShell(home.site);
    renderHero(home.site);
  } catch {
    // The page still works with the defaults already drawn.
  }
}

// Draw the header and footer immediately with defaults, then load.
renderShell();
initHeroShow(document.querySelector("[data-hero-show]"));
load();
