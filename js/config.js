/**
 * Site configuration: the one place to change where the API lives.
 * Location: js/config.js
 *
 * Every API call, and every document download link, is built from
 * API_ORIGIN. If the backend moves (a new Render service, a custom domain
 * like https://api.orlucommunity.org), change it here and nowhere else.
 *
 * The HTML pages also contain <link rel="preconnect" href="https://orlu-land-community-api.onrender.com">.
 * Those only warm up the connection early; if the API moves they stop
 * helping but nothing breaks. Update them when convenient.
 */

export const API_ORIGIN = "https://orlu-land-community-api.onrender.com";
export const API_PREFIX = "/api/v1";

/**
 * Where the website itself lives: "/" locally or on a custom domain,
 * "/orlu-zone/" on GitHub Pages. Worked out from this file's own address,
 * so it never needs editing. Use it for every link to a page or asset.
 */
export const SITE_BASE = new URL("../", import.meta.url).pathname;
