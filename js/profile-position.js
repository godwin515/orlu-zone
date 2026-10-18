/**
 * A person's position (e.g. "Chief Project Director").
 * Location: js/profile-position.js   (used by js/pages/profiles.js and js/admin/profiles.js)
 *
 * The API's community profiles have no position field yet, so the position is
 * stored as the first line of the biography:
 *
 *   Position: Chief Project Director
 *
 *   Chief Project Director, Compendium of Honour. ...
 *
 * If the backend later adds a real field (position, title or role), it is
 * used instead and the biography is left as it is.
 */

const POSITION_LINE = /^\s*(?:position|title|role)\s*:\s*(.+?)\s*(?:\r?\n|$)/i;

/** Split a biography into { position, biography } (the rest of the text). */
export function splitPosition(bio) {
  const text = String(bio || "");
  const m = POSITION_LINE.exec(text);
  if (!m) return { position: "", biography: text.trim() };
  return { position: m[1].trim(), biography: text.slice(m[0].length).trim() };
}

/** Put a position back on the first line of a biography. */
export function joinPosition(position, bio) {
  const p = String(position || "").trim();
  const b = String(bio || "").trim();
  if (!p) return b;
  return b ? `Position: ${p}\n\n${b}` : `Position: ${p}`;
}

/** The position for a profile: a real API field if there is one, else the first line. */
export function positionOf(profile) {
  const field = profile?.position || profile?.title || profile?.role;
  if (field) return { position: String(field).trim(), biography: String(profile.biography || "").trim() };
  return splitPosition(profile?.biography);
}
