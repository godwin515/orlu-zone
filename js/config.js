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
 * Social media accounts, shown under "Follow us" on the Contact page.
 * The backend has no fields for these yet, so they live here.
 *
 * Paste the full web address of each account between the quotes.
 * Leave one empty ("") to hide it. WhatsApp comes from Admin → Site settings.
 *   facebook:  "https://www.facebook.com/YourPage"
 *   instagram: "https://www.instagram.com/yourname"
 *   x:         "https://x.com/yourname"
 *   youtube:   "https://www.youtube.com/@yourchannel"
 *   tiktok:    "https://www.tiktok.com/@yourname"
 *   linkedin:  "https://www.linkedin.com/company/yourname"
 */
export const SOCIAL_LINKS = {
  facebook: "",
  instagram: "",
  x: "",
  youtube: "",
  tiktok: "",
  linkedin: "",
};

/**
 * The place shown on the Contact page map, and where "Get directions" goes.
 * The street address from Admin → Site settings still shows as text; this
 * is only what the map searches for. Change it here if the map should point
 * somewhere else (a town, landmark or "latitude,longitude" all work).
 */
export const MAP_LOCATION = "Uzombi, Imo State, Nigeria";
