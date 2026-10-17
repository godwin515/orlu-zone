/**
 * Rich-text rendering for post, event and page content.
 * Location: js/content.js
 *
 * The backend hasn't confirmed whether `content` is Markdown or HTML, so
 * this handles both:
 *   - looks like HTML  -> sanitized with DOMPurify
 *   - anything else    -> parsed as Markdown with marked, then sanitized
 * If either library fails to load, content is shown as plain paragraphs.
 *
 * Needs these two scripts on the page (before the module script):
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js"></script>
 *
 * Once the backend confirms the format, delete the branch you don't need.
 */

import { escapeHtml } from "./ui.js";

const HTML_PATTERN = /<\/?(p|div|h[1-6]|ul|ol|li|br|strong|em|a|img|blockquote|figure|table)\b/i;

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "form", "input", "button"],
  FORBID_ATTR: ["style", "onerror", "onclick"],
};

/** Readable text from HTML without running it (used only if DOMPurify failed to load). */
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html"); // inert: no scripts run
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  doc.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, tr, br, div").forEach((el) => el.after("\n\n"));
  return (doc.body.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

function plainParagraphs(text) {
  return String(text)
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Returns safe HTML for a content string. */
export function renderContent(content) {
  if (!content) return "";
  const purify = window.DOMPurify;
  const marked = window.marked;

  if (!purify) {
    return plainParagraphs(HTML_PATTERN.test(content) ? htmlToText(content) : content);
  }

  const raw = HTML_PATTERN.test(content)
    ? content
    : marked
      ? marked.parse(content, { gfm: true, breaks: true })
      : plainParagraphs(content);

  return purify.sanitize(raw, PURIFY_CONFIG);
}

/**
 * Tidy rendered content in place: external links open in a new tab,
 * images lazy-load, and wide tables can scroll on phones.
 */
export function enhanceContent(container) {
  container.querySelectorAll("a[href]").forEach((a) => {
    try {
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    } catch {
      /* leave malformed links alone */
    }
  });
  container.querySelectorAll("img").forEach((img) => {
    img.loading = "lazy";
    if (!img.hasAttribute("alt")) img.alt = "";
  });
  container.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.classList.contains("table-scroll")) return;
    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });
}

/**
 * Turn a video URL into an embed. YouTube and Vimeo get an iframe;
 * anything else becomes a plain link.
 */
export function videoEmbed(url, title = "Video") {
  if (!url) return "";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (!/^https?:$/.test(parsed.protocol)) return "";

  const host = parsed.hostname.replace(/^www\.|^m\./, "");
  let embed = null;

  if (host === "youtube.com" && parsed.searchParams.get("v")) {
    embed = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(parsed.searchParams.get("v"))}`;
  } else if (host === "youtube.com" && parsed.pathname.startsWith("/shorts/")) {
    embed = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(parsed.pathname.split("/")[2])}`;
  } else if (host === "youtu.be") {
    embed = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(parsed.pathname.slice(1))}`;
  } else if (host === "vimeo.com" && /^\/\d+/.test(parsed.pathname)) {
    embed = `https://player.vimeo.com/video/${parsed.pathname.split("/")[1]}`;
  }

  if (embed) {
    return `
      <div class="video">
        <iframe src="${escapeHtml(embed)}" title="${escapeHtml(title)}" loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowfullscreen></iframe>
      </div>`;
  }
  return `<p class="video-link"><a href="${escapeHtml(parsed.href)}" target="_blank" rel="noopener noreferrer">Watch the video</a></p>`;
}
