/**
 * Leadership page: published community profiles.
 * Location: js/pages/profiles.js   (loaded by profiles.html)
 *
 * GET /community-profiles returns published profiles already in the order
 * the admin set. They're grouped by category, keeping that order: groups
 * appear in the order their first profile appears, and people keep their
 * order within each group.
 *
 * Photos use profile_media_url as the contract says; profiles without one
 * get their initials instead. There's no separate page per person: the
 * full bio shows on the card, with "Read more" for long ones.
 */

import { api } from "../api.js";
import { escapeHtml, safeUrl, renderShell, initShell, showLoading, showEmpty, showError } from "../ui.js";

const LONG_BIO = 320; // characters before a bio is folded behind "Read more"

const els = {
  list: document.querySelector("[data-profiles]"),
  jump: document.querySelector("[data-jump]"),
};

/* ---------------- Helpers ---------------- */

// Titles skipped when making initials, so "Mrs Ngozi Eze" gives "NE", not "MN".
const TITLES = new Set([
  "mr", "mrs", "ms", "miss", "dr", "prof", "chief", "rev", "revd", "fr", "pastor", "sir", "hon", "engr", "barr",
  "arc", "elder", "deacon", "deaconess", "lolo", "ichie", "igwe", "nze", "ezinne", "hrh", "lady", "dame", "alhaji",
]);

function initials(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const real = words.filter((w) => !TITLES.has(w.toLowerCase().replace(/[.,]/g, "")));
  return ((real.length ? real : words).slice(0, 2).map((w) => w[0].toUpperCase()).join("")) || "?";
}

/** Plain-text bio -> paragraphs. Bios are shown as text, never as HTML. */
function bioHtml(text) {
  return String(text || "")
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function anchorFor(category, index) {
  const base = String(category || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `group-${base || index}`;
}

/** Group profiles by category, keeping the API's order. */
function groupByCategory(profiles) {
  const groups = new Map();
  for (const p of profiles) {
    const key = (p.category || "").trim() || "Community";
    // Match categories case-insensitively so "Elders" and "elders" don't split.
    const found = [...groups.keys()].find((k) => k.toLowerCase() === key.toLowerCase());
    const name = found || key;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(p);
  }
  return [...groups.entries()];
}

/* ---------------- Rendering ---------------- */

function cardHtml(p, i) {
  const bio = (p.biography || "").trim();
  const long = bio.length > LONG_BIO;
  const bioId = `bio-${i}`;
  const photo = safeUrl(p.profile_media_url);

  return `
    <li class="profile">
      <div class="profile__photo">
        ${
          photo
            ? `<img src="${photo}" alt="" loading="lazy">`
            : `<span class="profile__initials" aria-hidden="true">${escapeHtml(initials(p.name))}</span>`
        }
      </div>
      <div class="profile__body">
        <h3 class="profile__name">${escapeHtml(p.name)}</h3>
        ${
          bio
            ? `
          <div class="profile__bio${long ? " is-folded" : ""}" id="${bioId}">${bioHtml(bio)}</div>
          ${long ? `<button type="button" class="profile__more" aria-expanded="false" aria-controls="${bioId}" data-more>Read more</button>` : ""}`
            : ""
        }
      </div>
    </li>`;
}

function render(profiles) {
  const groups = groupByCategory(profiles);
  let n = 0;

  els.list.innerHTML = groups
    .map(([category, people], gi) => {
      const anchor = anchorFor(category, gi);
      return `
        <section class="profile-group" id="${anchor}" aria-labelledby="${anchor}-title">
          <div class="section-head">
            <h2 id="${anchor}-title">${escapeHtml(category)}</h2>
          </div>
          <ul class="profile-grid">${people.map((p) => cardHtml(p, n++)).join("")}</ul>
        </section>`;
    })
    .join("");

  // Jump links help when there are several groups.
  if (groups.length > 1) {
    els.jump.innerHTML = `
      <ul class="filters__list">
        ${groups
          .map(([category], gi) => `<li><a class="chip" href="#${anchorFor(category, gi)}">${escapeHtml(category)}</a></li>`)
          .join("")}
      </ul>`;
    els.jump.hidden = false;
  } else {
    els.jump.hidden = true;
  }
}

els.list.addEventListener("click", (e) => {
  const button = e.target.closest("[data-more]");
  if (!button) return;
  const bio = document.getElementById(button.getAttribute("aria-controls"));
  const open = button.getAttribute("aria-expanded") === "true";
  bio.classList.toggle("is-folded", open);
  button.setAttribute("aria-expanded", String(!open));
  button.textContent = open ? "Read more" : "Show less";
});

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.list, { lines: 5 });
  try {
    const profiles = await api.listProfiles();
    stop();
    if (!profiles?.length) {
      els.jump.hidden = true;
      showEmpty(els.list, "Profiles of the community's leaders will appear here soon.", {
        href: "/about.html",
        label: "Read about the community",
      });
      return;
    }
    render(profiles);
    // Opened with a #group link? Scroll there now that it exists.
    try {
      if (window.location.hash) document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
    } catch {
      /* odd hash: ignore */
    }
  } catch (error) {
    stop();
    showError(els.list, error, load);
  }
}

renderShell();
initShell().then((site) => {
  if (site?.community_name) document.title = `Leadership | ${site.community_name}`;
});
load();
