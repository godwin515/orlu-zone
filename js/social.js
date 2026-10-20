/**
 * Social media links and logos, shared by the footer (every page) and the
 * Contact page's "Follow us" section.
 * Location: js/social.js
 *
 * WhatsApp comes from Admin → Site settings; the other accounts are set in
 * js/config.js (SOCIAL_LINKS). Only accounts that are filled in show.
 */

import { SOCIAL_LINKS } from "./config.js";

/** "+2349036541164" from a wa.me link, shown as "+234 903 654 1164". */
export function whatsappNumber(url) {
  const m = /wa\.me\/\+?(\d{7,15})/i.exec(url || "");
  if (!m) return "";
  const d = m[1];
  if (d.startsWith("234") && d.length === 13) return `+234 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  return `+${d}`;
}

// Simple brand marks, drawn in currentColor.
export const SOCIAL = {
  whatsapp: {
    name: "WhatsApp",
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.2a9.8 9.8 0 0 0-8.4 14.9L2.3 21.8l4.8-1.3A9.8 9.8 0 1 0 12 2.2zm0 1.8a8 8 0 1 1-4.1 14.9l-.3-.2-2.8.8.8-2.7-.2-.3A8 8 0 0 1 12 4zm-3.2 3.9c-.2 0-.6.1-.9.4-.3.3-1.1 1.1-1.1 2.7s1.2 3.2 1.3 3.4c.2.2 2.3 3.6 5.7 4.9 2.8 1.1 3.4.9 4 .8.6-.1 2-.8 2.2-1.6.3-.8.3-1.5.2-1.6l-.6-.4-2.1-1c-.3-.1-.5-.2-.7.1l-1 1.2c-.2.2-.4.2-.7.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.4 0-.5l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6z"/></svg>`,
  },
  facebook: {
    name: "Facebook",
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.4 21.5v-7.7h2.6l.4-3h-3V8.9c0-.9.3-1.5 1.5-1.5h1.6V4.7a21 21 0 0 0-2.3-.1c-2.3 0-3.9 1.4-3.9 4v2.2H7.7v3h2.6v7.7z"/></svg>`,
  },
  instagram: {
    name: "Instagram",
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>`,
  },
  x: {
    name: "X",
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.6 3.5h3l-6.6 7.6 7.8 9.4h-6.1l-4.8-5.9-5.5 5.9H2.4l7-7.6L2 3.5h6.2l4.4 5.4zm-1 15.3h1.7L7.4 5.1H5.6z"/></svg>`,
  },
  youtube: {
    name: "YouTube",
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5a2.7 2.7 0 0 0-1.9 1.9C2 8.9 2 12 2 12s0 3.1.4 4.8a2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9c.4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8zM10 15.1V8.9l5.2 3.1z"/></svg>`,
  },
  tiktok: {
    name: "TikTok",
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.6 3h-3.2v12.2a2.7 2.7 0 1 1-2.7-2.7c.3 0 .5 0 .8.1V9.3l-.8-.1a6 6 0 1 0 6 6V9a7.6 7.6 0 0 0 4.3 1.4V7.2A4.4 4.4 0 0 1 16.6 3z"/></svg>`,
  },
  linkedin: {
    name: "LinkedIn",
    svg: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.9 8.7H3.7V20h3.2zM5.3 3.5a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8zM20.3 13.4c0-3-1.6-4.9-4.2-4.9a3.6 3.6 0 0 0-3.2 1.8V8.7H9.8V20H13v-5.9c0-1.6.5-2.9 2.1-2.9s2 1.4 2 3V20h3.2z"/></svg>`,
  },
};

/** "@orluzone" style label from an account's web address. */
export function handleFrom(network, url) {
  try {
    const u = new URL(url);
    if (network === "whatsapp") return whatsappNumber(url) || "Chat with us";
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return u.hostname.replace(/^www\./, "");
    const last = network === "linkedin" ? parts[parts.length - 1] : parts[0];
    if (network === "linkedin" || network === "facebook") return last.replace(/^@/, "");
    return last.startsWith("@") ? last : `@${last}`;
  } catch {
    return "";
  }
}

/** [network, url] pairs to show: WhatsApp first, then the config order. */
export function socialLinks(site) {
  const links = [];
  const wa = site?.whatsapp_url && /^https:\/\//i.test(site.whatsapp_url) ? site.whatsapp_url : null;
  if (wa) links.push(["whatsapp", wa]);
  for (const [network, url] of Object.entries(SOCIAL_LINKS || {})) {
    if (SOCIAL[network] && typeof url === "string" && /^https:\/\//i.test(url.trim())) links.push([network, url.trim()]);
  }
  return links;
}
