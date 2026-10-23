/**
 * Contact page.
 * Location: js/pages/contact.js   (loaded by contact.html)
 *
 * Two sources:
 *   - GET /site           phone, email, WhatsApp link and address (the cards and map)
 *   - GET /pages/contact  the page title and text (opening hours, notes)
 * The cards show even if the "contact" page hasn't been created yet.
 * There is no contact-form endpoint in the API, so there is no form here.
 * Social media accounts for "Follow us" are set in js/config.js (SOCIAL_LINKS).
 * To change the details, edit Admin → Site settings.
 */

import { api } from "../api.js";
import { SOCIAL, socialLinks, handleFrom } from "../social.js";
import { MAP_LOCATION } from "../config.js";
import { escapeHtml, renderShell, initShell, showLoading, showError } from "../ui.js";
import { renderContent, enhanceContent } from "../content.js";

const SLUG = "contact";

const els = {
  title: document.querySelector("[data-page-title]"),
  contact: document.querySelector("[data-contact]"),
  map: document.querySelector("[data-contact-map]"),
  social: document.querySelector("[data-social]"),
  content: document.querySelector("[data-page-content]"),
};

const DEFAULT_TITLE = "Contact us";

const ICONS = {
  whatsapp: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c.3 1.6 1.9 3.6 4 4.5l1.2-1.1 1.8.8c-.2 1-1 1.7-2 1.7-3.3 0-6.5-3.2-6.5-6.5 0-1 .7-1.8 1.7-2l.8 1.8z"/></svg>`,
  email: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/></svg>`,
  address: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`,
};

function card({ kind, label, value, href, action, external = false, wide = false }) {
  return `
    <article class="contact-card contact-card--${kind}${wide ? " contact-card--wide" : ""}">
      <span class="contact-card__icon">${ICONS[kind]}</span>
      <h3 class="contact-card__label">${escapeHtml(label)}</h3>
      <p class="contact-card__value">${value}</p>
      <a class="button ${kind === "whatsapp" ? "button--gold" : "contact-card__button"}" href="${escapeHtml(href)}"
        ${external ? 'target="_blank" rel="noopener"' : ""}>${escapeHtml(action)}</a>
    </article>`;
}

function contactHtml(site) {
  const cards = [];
  const whatsapp = site?.whatsapp_url && /^https:\/\//i.test(site.whatsapp_url) ? site.whatsapp_url : null;

  if (whatsapp) {
    cards.push(
      card({
        kind: "whatsapp",
        label: "WhatsApp",
        value: "Chat with us directly", // the number itself isn't shown; the button opens the chat
        href: whatsapp,
        action: "Chat on WhatsApp",
        external: true,
      }),
    );
  }
  if (site?.phone) {
    const tel = site.phone.replace(/[^\d+]/g, "");
    // The number isn't shown; the button still calls it.
    cards.push(card({ kind: "phone", label: "Phone", value: "Speak to us directly", href: `tel:${tel}`, action: "Call us" }));
  }
  if (site?.email) {
    cards.push(
      card({
        kind: "email",
        label: "Email",
        value: `<span class="contact-card__email">${escapeHtml(site.email)}</span>`,
        href: `mailto:${site.email}`,
        action: "Send an email",
      }),
    );
  }
  if (site?.address) {
    const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(MAP_LOCATION || site.address)}`;
    cards.push(
      card({
        kind: "address",
        label: "Visit us",
        value: escapeHtml(site.address),
        href: map,
        action: "Get directions",
        external: true,
      }),
    );
  }

  if (!cards.length) {
    return `<p class="contact-empty">Contact details haven't been added yet.</p>`;
  }
  return `<div class="contact-cards contact-cards--${cards.length}">${cards.join("")}</div>`;
}

/** A map of the address (Google Maps embed, no key needed). */
function mapHtml(site) {
  if (!site?.address) return "";
  const src = `https://www.google.com/maps?q=${encodeURIComponent(MAP_LOCATION || site.address)}&output=embed`;
  return `
    <figure class="contact-map">
      <iframe src="${escapeHtml(src)}" title="Map: ${escapeHtml(MAP_LOCATION || site.address)}" loading="lazy"
        referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
      <figcaption class="contact-map__caption">
        <span class="contact-map__pin" aria-hidden="true">${ICONS.address}</span>
        <span>${escapeHtml(site.address)}</span>
      </figcaption>
    </figure>`;
}

/* ---------------- Follow us ---------------- */

function socialHtml(site) {
  const links = socialLinks(site);
  if (!links.length) return "";
  return `
    <section class="contact-social" aria-labelledby="social-title">
      <h2 class="contact-help__title" id="social-title">Follow us</h2>
      <p class="contact-social__lead">Stay up to date with Orlu Land Compendium news, honours and events.</p>
      <ul class="contact-social__list">
        ${links
          .map(
            ([network, url]) => `
          <li>
            <a class="social-link social-link--${network}" href="${escapeHtml(url)}" target="_blank" rel="noopener"
              aria-label="${escapeHtml(SOCIAL[network].name)}: ${escapeHtml(handleFrom(network, url))} (opens in a new tab)">
              <span class="social-link__logo">${SOCIAL[network].svg}</span>
              <span class="social-link__text">
                <span class="social-link__name">${escapeHtml(SOCIAL[network].name)}</span>
                <span class="social-link__handle">${escapeHtml(handleFrom(network, url))}</span>
              </span>
            </a>
          </li>`,
          )
          .join("")}
      </ul>
    </section>`;
}

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.content, { lines: 3 });
  try {
    const [page, site] = await Promise.all([api.getPage(SLUG), shell]);
    stop();

    if (!page) {
      // The "contact" page hasn't been created in the backend yet; the cards are enough.
      els.content.innerHTML = "";
      return;
    }

    const title = page.title || DEFAULT_TITLE;
    els.title.textContent = title;
    document.title = site?.community_name ? `${title} | ${site.community_name}` : title;

    els.content.innerHTML = page.content ? `<div class="prose">${renderContent(page.content)}</div>` : "";
    const prose = els.content.querySelector(".prose");
    if (prose) enhanceContent(prose);
  } catch (error) {
    stop();
    showError(els.content, error, load);
  }
}

renderShell();
const shell = initShell(); // also gives us the contact details from /site

// The cards depend only on /site, so they fill in as soon as that arrives,
// even if the page text is slow or fails.
const stopPanel = showLoading(els.contact, { lines: 3 });
shell.then((site) => {
  stopPanel();
  els.contact.innerHTML = contactHtml(site);
  els.map.innerHTML = mapHtml(site);
  els.social.innerHTML = socialHtml(site);
});

load();
