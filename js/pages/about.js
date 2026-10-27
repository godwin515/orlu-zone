/**
 * About page.
 * Location: js/pages/about.js   (loaded by about.html)
 *
 * The main About content (Orlu Land, the 12 LGAs, the Orashi River, the
 * Compendium and the Aku Ruo Ulo investment write-up) is written directly
 * in about.html.
 *
 * Anything the admin writes for the "about" page (GET /pages/about, edited
 * in Admin > Pages) is added under the Orlu Land introduction. If there is
 * none yet, or the server can't be reached, nothing extra is shown.
 */

import { api } from "../api.js";
import { renderShell, initShell } from "../ui.js";
import { renderContent, enhanceContent } from "../content.js";

const SLUG = "about";
const slot = document.querySelector("[data-page-content]");

async function loadExtra() {
  try {
    const page = await api.getPage(SLUG);
    if (!page?.content) return;
    slot.innerHTML = `<div class="prose about-extra">${renderContent(page.content)}</div>`;
    enhanceContent(slot.querySelector(".prose"));
  } catch {
    /* the page is complete without it */
  }
}

renderShell();
initShell().then((site) => {
  if (site?.community_name) document.title = `About Orlu Land | ${site.community_name}`;
});
loadExtra();
