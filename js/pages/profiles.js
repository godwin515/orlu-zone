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
 * get their initials instead.
 *
 * Each card shows a short summary; "Read full profile" opens the whole
 * profile full-screen, like the Compendium's profile pages. Each profile
 * has its own link: profiles.html#person-<id>.
 *
 * A person's position ("Chief Project Director") shows under their name in
 * gold small capitals between two diamonds. It
 * comes from the first line of the biography, "Position: …" (see
 * js/profile-position.js), until the API has a field for it.
 *
 * The biography is plain text. Simple formatting is read from it:
 *   - the first paragraph is the bold summary
 *   - a short line on its own (e.g. "Overview") becomes a gold heading
 *   - lines starting with "- " or "• " become bullet points
 */

import { api } from "../api.js";
import { escapeHtml, safeUrl, renderShell, initShell, showLoading, showEmpty, showError } from "../ui.js";

const PERSON_HASH = "#person-";
let current = []; // profiles on the page, for opening by id

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

/* ---------------- Position ---------------- */

// The API has no position field yet, so it is stored as the biography's first
// line: "Position: Chief Project Director". The admin Leadership form has a
// Position box that writes it. A real position/title/role field wins if the
// backend adds one. Same rules as js/profile-position.js (used by the admin).
const POSITION_LINE = /^\s*(?:position|title|role)\s*:\s*(.+?)\s*(?:\r?\n|$)/i;

function positionOf(profile) {
  const field = profile?.position || profile?.title || profile?.role;
  const bio = String(profile?.biography || "");
  if (field) return { position: String(field).trim(), biography: bio.trim() };
  const m = POSITION_LINE.exec(bio);
  if (!m) return { position: "", biography: bio.trim() };
  return { position: m[1].trim(), biography: bio.slice(m[0].length).trim() };
}

/* ---------------- Biography formatting ---------------- */

const BULLET = /^\s*(?:[-•*]|\d+[.)])\s+/;

function isHeadingLine(line, next) {
  const t = line.trim();
  if (!t || BULLET.test(t) || t.length > 48 || /[.!?,;]$/.test(t)) return false;
  // A short line followed by more text, or ending in ":" ("Education:")
  return /:$/.test(t) || Boolean(next && next.trim());
}

/**
 * Plain-text biography -> blocks: { type: "p" | "h" | "ul", text | items }.
 * Never HTML: everything is escaped when rendered.
 */
function parseBio(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list?.length) blocks.push({ type: "ul", items: list });
    list = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      return;
    }
    if (BULLET.test(line)) {
      flushPara();
      (list ||= []).push(line.replace(BULLET, ""));
      return;
    }
    flushList();
    const startsBlock = para.length === 0;
    if (startsBlock && blocks.length > 0 && isHeadingLine(line, lines[i + 1])) {
      blocks.push({ type: "h", text: line.replace(/:$/, "") });
      return;
    }
    para.push(line);
  });
  flushPara();
  flushList();
  return blocks;
}

/** The summary: the first paragraph of the biography. */
function summaryOf(bio) {
  const first = parseBio(bio).find((b) => b.type === "p");
  return first ? first.text : "";
}

/** Group blocks under their headings; each heading starts a boxed section. */
function sectionsHtml(blocks) {
  if (!blocks.length) return "";
  const sections = [];
  let cur = { title: "", blocks: [] };
  for (const b of blocks) {
    if (b.type === "h") {
      if (cur.title || cur.blocks.length) sections.push(cur);
      cur = { title: b.text, blocks: [] };
    } else {
      cur.blocks.push(b);
    }
  }
  if (cur.title || cur.blocks.length) sections.push(cur);
  return sections
    .map(
      (sec) => `
      <section class="person__section">
        ${sec.title ? `<h3>${escapeHtml(sec.title)}</h3>` : ""}
        ${blocksHtml(sec.blocks)}
      </section>`,
    )
    .join("");
}

function blocksHtml(blocks) {
  return blocks
    .map((b) => {
      if (b.type === "h") return `<h3>${escapeHtml(b.text)}</h3>`;
      if (b.type === "ul") return `<ul>${b.items.map((it) => `<li>${escapeHtml(it)}</li>`).join("")}</ul>`;
      return `<p>${escapeHtml(b.text)}</p>`;
    })
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
/*
 * Category names to show differently from how they were typed in the admin.
 * Left: the name saved in Admin → Leadership (any capitals). Right: what the
 * website shows. Once the admin name is changed, the line can be removed.
 */
const CATEGORY_RENAMES = {
  "board of editorial members": "Editorial Board Members",
};

function displayCategory(name) {
  const clean = String(name || "").trim();
  return CATEGORY_RENAMES[clean.toLowerCase()] || clean;
}

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

function photoHtml(p, { lazy = true } = {}) {
  const photo = safeUrl(p.profile_media_url);
  return photo
    ? `<img src="${photo}" alt="" ${lazy ? 'loading="lazy"' : ""}>`
    : `<span class="profile__initials" aria-hidden="true">${escapeHtml(initials(p.name))}</span>`;
}

/** The position as an engraved line: gold small capitals between two diamonds. */
function positionHtml(position, cls = "position") {
  if (!position) return "";
  // Keep the last word and the closing diamond together when the line wraps.
  const words = escapeHtml(position).split(" ");
  const last = words.pop();
  const head = words.length ? `${words.join(" ")} ` : "";
  return `<p class="${cls}"><span>${head}<span class="position__last">${last}</span></span></p>`;
}

function cardHtml(p) {
  const { position, biography } = positionOf(p);
  const summary = summaryOf(biography);
  return `
    <li class="profile">
      <div class="profile__photo">${photoHtml(p)}</div>
      <h3 class="profile__name">${escapeHtml(p.name)}</h3>
      ${positionHtml(position || (p.category || "").trim(), "position profile__position")}
      ${summary ? `<p class="profile__bio">${escapeHtml(summary)}</p>` : ""}
      <a class="profile__more" href="${PERSON_HASH}${encodeURIComponent(p.id)}" data-person="${escapeHtml(p.id)}"
        aria-label="Read the full profile of ${escapeHtml(p.name)}">Read full profile</a>
    </li>`;
}

function render(profiles) {
  current = profiles;
  const groups = groupByCategory(profiles);

  els.list.innerHTML = groups
    .map(([category, people], gi) => {
      const anchor = anchorFor(category, gi);
      return `
        <section class="profile-group" id="${anchor}" aria-labelledby="${anchor}-title">
          <header class="group-title">
            <div class="group-title__row">
              <span class="group-title__rule" aria-hidden="true"></span>
              <h2 class="group-title__name" id="${anchor}-title">${escapeHtml(category)}</h2>
              <span class="group-title__rule" aria-hidden="true"></span>
            </div>
            <p class="group-title__caption">${escapeHtml(captionFor(category))}</p>
          </header>
          <ul class="profile-grid">${people.map((p) => cardHtml(p)).join("")}</ul>
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

/* ---------------- Links from the homepage's Who's Who categories ----------------
 * The homepage links to profiles.html#cat=<key>. Admin category names vary
 * ("Political Leaders", "Politics and Public Service"…), so each key matches
 * any category whose name contains one of its keywords. The first match wins.
 */
const WHOSWHO = {
  royal: { label: "Traditional Rulers & Titled Chiefs", words: ["royal", "traditional", "ruler", "eze", "igwe", "chief", "king", "monarch"],
    caption: "Ndi Eze, royal fathers and titled chiefs: custodians of our customs, culture and heritage across Orlu Zone." },
  politics: { label: "Public Service & Politics", words: ["politic", "public service", "government", "legislat", "senat", "council"],
    caption: "Governors, senators, legislators and public office holders who have served Orlu Zone, Imo State and Nigeria." },
  business: { label: "Business & Industry", words: ["business", "industry", "industri", "captain", "entrepreneur", "enterprise", "commerce"],
    caption: "Entrepreneurs, bankers and industrialists whose enterprise creates jobs and wealth at home and abroad." },
  professionals: { label: "Professionals & Academics", words: ["professional", "academ", "scholar", "education", "lecturer", "professor"],
    caption: "Professors, doctors, engineers, lawyers and scholars whose knowledge and skill bring honour to Orlu Zone." },
  clergy: { label: "Clergy & Faith Leaders", words: ["clergy", "faith", "church", "religio", "bishop", "pastor", "priest"],
    caption: "Bishops, priests, pastors and faith leaders who guide our people in faith, service and good conscience." },
  philanthropy: { label: "Philanthropy & Community Service", words: ["philanthrop", "community service", "charit", "humanitarian"],
    caption: "Sons and daughters who give their time and wealth to build schools, roads, hospitals and hope at home." },
  women: { label: "Women Leaders", words: ["women", "woman", "female", "mothers", "august meeting", "cwo"],
    caption: "Women who lead in business, public service, faith and community across Orlu Zone and the diaspora." },
  youth: { label: "Youth, Arts & Sports", words: ["youth", "art", "sport", "young"],
    caption: "Young achievers, artists and sportsmen and women carrying the name of Orlu Zone forward." },
  editorial: { label: "Editorial Board", words: ["editorial", "editor", "compendium team", "project team", "secretariat"],
    caption: "The team behind the Compendium of Honour: research, writing, verification and records." },
  posthumous: { label: "Posthumous Honours", words: ["posthumous", "memoriam", "in memory", "late", "departed"],
    caption: "In loving memory of the departed patriarchs, matriarchs and illustrious sons and daughters of Orlu Land." },
};

// Short keywords that must be whole words ("art" not "Partners", "late" not "Translate")
const WHOLE_WORDS = new Set(["art", "late"]);

const SKIP_WORDS = new Set(["and", "the", "of", "leaders", "leader", "titled", "service"]);

/** Which Who's Who category a category name from the admin belongs to (or null). */
function keyForName(name) {
  const lower = String(name || "").toLowerCase();
  for (const [key, entry] of Object.entries(WHOSWHO)) {
    if (entry.words.some((w) => (WHOLE_WORDS.has(w) ? new RegExp(`\\b${w}s?\\b`).test(lower) : lower.includes(w)))) return key;
  }
  return null;
}

const DEFAULT_CAPTION = "Distinguished sons and daughters of Orlu Zone, honoured for their service and achievements.";

/** The short write-up shown under a category's title. */
function captionFor(category) {
  return WHOSWHO[keyForName(category)]?.caption || DEFAULT_CAPTION;
}

function findGroup(key) {
  const entry = WHOSWHO[key];
  if (!entry) return null;
  const sections = [...els.list.querySelectorAll(".profile-group")];
  const nameOf = (section) => (section.querySelector("h2")?.textContent || "").toLowerCase();
  // 1. Keywords for this tile
  for (const section of sections) {
    const name = nameOf(section);
    if (entry.words.some((w) => (WHOLE_WORDS.has(w) ? new RegExp(`\\b${w}s?\\b`).test(name) : name.includes(w)))) return section;
  }
  // 2. Any word from the tile's own label ("Industry", "Faith", "Sports"…)
  const labelWords = entry.label
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3 && !SKIP_WORDS.has(w));
  for (const section of sections) {
    const name = nameOf(section);
    if (labelWords.some((w) => name.includes(w.slice(0, Math.max(5, w.length - 2))))) return section;
  }
  return null;
}

function openCategory(key) {
  const section = findGroup(key);
  els.list.querySelector(".group-missing")?.remove();
  if (section) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    section.classList.remove("is-target");
    void section.offsetWidth; // restart the highlight
    section.classList.add("is-target");
    return;
  }
  // No category for it yet: say so at the top of the list.
  const label = WHOSWHO[key]?.label;
  if (!label) return;
  const note = document.createElement("p");
  note.className = "group-missing";
  note.setAttribute("role", "status");
  note.textContent = `No profiles have been added for ${label} yet. Here are all the profiles.`;
  els.list.prepend(note);
  note.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** The category key from a #cat=… link, if the page was opened with one. */
function categoryFromHash() {
  const hash = window.location.hash;
  return hash.startsWith("#cat=") ? decodeURIComponent(hash.slice(5)) : "";
}

/* ---------------- Full profile ---------------- */

let view = null;
let returnFocus = null;

function buildView() {
  view = document.createElement("dialog");
  view.className = "person";
  view.setAttribute("aria-labelledby", "person-name");
  document.body.appendChild(view);
  view.addEventListener("close", () => {
    // Drop the #person-… link from the address bar, keep the page where it was.
    if (window.location.hash.startsWith(PERSON_HASH)) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    returnFocus?.focus({ preventScroll: true });
  });
  view.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) view.close();
  });
  return view;
}

function openPerson(id, { updateHash = true } = {}) {
  const p = current.find((x) => String(x.id) === String(id));
  if (!p) return false;
  const dialog = view || buildView();
  const { position, biography } = positionOf(p);
  const blocks = parseBio(biography);
  const firstPara = blocks.findIndex((b) => b.type === "p");
  const lead = firstPara >= 0 ? blocks.splice(firstPara, 1)[0].text : "";

  dialog.innerHTML = `
    <div class="person__layout">
      <aside class="person__side">
        <button type="button" class="person__close" data-close>
          <span aria-hidden="true">✕</span> Close
        </button>
        <div class="person__photo">${photoHtml(p, { lazy: false })}</div>
        <h2 class="person__name" id="person-name">${escapeHtml(p.name)}</h2>
        ${positionHtml(position, "position position--large person__position")}
        ${lead ? `<p class="person__lead">${escapeHtml(lead)}</p>` : ""}
      </aside>
      <div class="person__main">
        ${sectionsHtml(blocks)}
        <p class="person__back"><button type="button" class="button button--quiet" data-close>Back to all profiles</button></p>
      </div>
    </div>`;

  if (updateHash) history.replaceState(null, "", `${PERSON_HASH}${encodeURIComponent(p.id)}`);
  document.title = `${p.name} | Leadership`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  dialog.querySelector(".person__close").focus();
  return true;
}

els.list.addEventListener("click", (e) => {
  const link = e.target.closest("[data-person]");
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  returnFocus = link;
  openPerson(link.dataset.person);
});

// Opened (or navigated) with a #person-… link
window.addEventListener("hashchange", () => {
  if (window.location.hash.startsWith("#cat=")) {
    openCategory(decodeURIComponent(window.location.hash.slice(5)));
    return;
  }
  if (window.location.hash.startsWith(PERSON_HASH)) {
    openPerson(decodeURIComponent(window.location.hash.slice(PERSON_HASH.length)), { updateHash: false });
  }
});

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.list, { lines: 5 });
  try {
    const profiles = ((await api.listProfiles()) || []).map((p) => ({ ...p, category: displayCategory(p.category) }));
    stop();
    if (!profiles?.length) {
      els.jump.hidden = true;
      const wanted = WHOSWHO[categoryFromHash()]?.label;
      showEmpty(els.list, wanted
        ? `No profiles have been added for ${wanted} yet. Profiles of the community's leaders will appear here soon.`
        : "Profiles of the community's leaders will appear here soon.", {
        href: "/about.html",
        label: "Read about the community",
      });
      return;
    }
    render(profiles);
    // Opened with a #person-… link? Show that profile. A #group link? Scroll there.
    try {
      const hash = window.location.hash;
      if (hash.startsWith(PERSON_HASH)) {
        openPerson(decodeURIComponent(hash.slice(PERSON_HASH.length)), { updateHash: false });
      } else if (hash.startsWith("#cat=")) {
        openCategory(decodeURIComponent(hash.slice(5)));
      } else if (hash) {
        document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
      }
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
