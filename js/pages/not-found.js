/**
 * "Page not found" page.
 * Location: js/pages/not-found.js   (loaded by 404.html)
 *
 * Shows the address that wasn't found, a search box with suggestions,
 * and links to the main sections. No API call except /site for the
 * header and footer.
 */

import { renderShell, initShell } from "../ui.js";
import { attachSuggestions } from "../search-suggest.js";

const pathEl = document.querySelector("[data-missing-path]");
let path = window.location.pathname + window.location.search;
try {
  path = decodeURIComponent(path); // show "/my page", not "/my%20page"
} catch {
  /* keep the raw address if it isn't valid encoding */
}

// textContent, never innerHTML: the address comes from the visitor.
if (pathEl) {
  if (path && path !== "/404.html") {
    pathEl.textContent = path.length > 60 ? `${path.slice(0, 57)}…` : path;
  } else {
    pathEl.closest(".lost__text").textContent =
      "That page doesn't exist. It may have been moved, or the link may be mistyped.";
  }
}

attachSuggestions(document.querySelector("[data-search-input]"));

renderShell();
initShell().then((site) => {
  document.title = site?.community_name ? `Page not found | ${site.community_name}` : "Page not found";
});
