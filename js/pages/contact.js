/**
 * Contact page.
 * Location: js/pages/contact.js   (loaded by contact.html)
 *
 * Two sources:
 *   - GET /site           phone, email, WhatsApp link and address ("Reach us" panel)
 *   - GET /pages/contact  the page title and text (opening hours, notes)
 * The panel shows even if the "contact" page hasn't been created yet.
 * There is no contact-form endpoint in the API, so there is no form here.
 */

import { api } from "../api.js";
import { escapeHtml, renderShell, initShell, showLoading, showError } from "../ui.js";
import { renderContent, enhanceContent } from "../content.js";

const SLUG = "contact";

const els = {
  title: document.querySelector("[data-page-title]"),
  contact: document.querySelector("[data-contact]"),
  content: document.querySelector("[data-page-content]"),
};

const DEFAULT_TITLE = "Contact us";

/* ---------------- Contact details ---------------- */

function contactHtml(site) {
  const rows = [];

  if (site?.phone) {
    const tel = site.phone.replace(/[^\d+]/g, "");
    rows.push(`
      <div class="contact-method">
        <dt>Phone</dt>
        <dd><a href="tel:${escapeHtml(tel)}">${escapeHtml(site.phone)}</a></dd>
      </div>`);
  }
  if (site?.email) {
    rows.push(`
      <div class="contact-method contact-method--email">
        <dt>Email</dt>
        <dd><a href="mailto:${escapeHtml(site.email)}">${escapeHtml(site.email)}</a></dd>
      </div>`);
  }
  if (site?.address) {
    const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address)}`;
    rows.push(`
      <div class="contact-method">
        <dt>Address</dt>
        <dd>
          <span class="contact-method__address">${escapeHtml(site.address)}</span>
          <a class="contact-method__extra" href="${escapeHtml(map)}" target="_blank" rel="noopener">Open in Google Maps</a>
        </dd>
      </div>`);
  }

  const whatsapp = site?.whatsapp_url && /^https:\/\//i.test(site.whatsapp_url) ? site.whatsapp_url : null;

  if (!rows.length && !whatsapp) {
    return `<p class="contact-empty">Contact details haven't been added yet.</p>`;
  }

  return `
    ${whatsapp ? `
      <a class="button button--gold contact-whatsapp" href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener">
        Message us on WhatsApp
      </a>` : ""}
    ${rows.length ? `<dl class="contact-methods">${rows.join("")}</dl>` : ""}`;
}

/* ---------------- Load ---------------- */

async function load() {
  const stop = showLoading(els.content, { lines: 5 });
  try {
    const [page, site] = await Promise.all([api.getPage(SLUG), shell]);
    stop();

    if (!page) {
      // The "contact" page hasn't been created in the backend yet; the panel is enough.
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

// The "Reach us" panel depends only on /site, so it fills in as soon as that
// arrives, even if the page text is slow or fails.
const stopPanel = showLoading(els.contact, { lines: 3 });
shell.then((site) => {
  stopPanel();
  els.contact.innerHTML = contactHtml(site);
});

load();
