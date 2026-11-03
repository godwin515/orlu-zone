# Security checklist: Orlu Land Compendium website

**Location:** `docs/security-checklist.md` (not published: `docs` is listed in `.assetsignore`)

The website (this folder) is static HTML, CSS and JavaScript. It has no
passwords, database or server code of its own; everything sensitive lives
in the FastAPI backend on Render. Real protection against hackers therefore
needs **both** parts below.

---

## Part 1: Website (already done in this folder)

| Protection | Where | What it stops |
|---|---|---|
| Content Security Policy | `_headers` | Scripts injected into the page, or loaded from unknown sites, can't run. Tested: injected code was blocked. |
| `X-Frame-Options: DENY`, `frame-ancestors 'none'` | `_headers` | Other sites can't show your pages in a hidden frame to trick clicks (clickjacking). |
| `Strict-Transport-Security` | `_headers` | Browsers always use the secure https:// address after the first visit. |
| `X-Content-Type-Options: nosniff` | `_headers` | Uploaded files can't be disguised as scripts. |
| `Referrer-Policy`, `Permissions-Policy` | `_headers` | No full page addresses leak to other sites; camera, microphone and location are switched off. |
| Admin pages hidden and not cached | `_headers`, `robots.txt`, `<meta name="robots">` | Search engines don't list the admin area; admin screens aren't stored by browsers or proxies. |
| Auto sign-out after 30 minutes idle | `js/admin/guard.js` | An admin left open on a shared or lost computer signs itself out. |
| Safe redirect after sign-in | `js/admin/guard.js` (`safeNext`) | The sign-in page can't be used to send people to another site. |
| Text from the API is escaped | `escapeHtml` in `js/ui.js` | Names, titles and captions can't inject code. Markdown is cleaned by DOMPurify. |
| Deleting needs confirmation | admin pages | Accidental or one-click destructive actions. |

`_headers` is read by Cloudflare when the site is published. After deploying,
check it at <https://securityheaders.com> (enter your site address; you
should get an **A**).

If you later add a new outside service (another font, video site or map),
add its address to the matching part of the `Content-Security-Policy` line
in `_headers`, or the browser will block it.

## Part 2: Backend (FastAPI on Render): ask your backend developer

These matter most, because the backend holds the data and the admin login.

1. **Limit login attempts.** Block or slow down an IP or email after about 5
   failed sign-ins in 15 minutes (for example with `slowapi`). This stops
   password-guessing attacks.
2. **Strong admin passwords.** At least 12 characters; never reuse one used
   elsewhere. Hash with bcrypt or argon2 (never store plain passwords).
3. **Short-lived tokens.** Access tokens should expire (for example after
   8–24 hours). Rotate the token secret key if it may have leaked.
4. **Lock CORS to your real addresses.** `allow_origins` should list only
   your live site (and `http://127.0.0.1:5500` while developing), never `*`.
5. **Secrets in environment variables.** Database URL, token secret and R2
   keys in Render's Environment settings, never in the code or on GitHub.
6. **Check uploads on the server.** Accept only real JPEG, PNG, WebP and PDF
   files (check the file's content, not just its name) and enforce size limits.
7. **Every admin endpoint requires a valid token**, including the new
   `PATCH /admin/media/{id}` for captions.
8. **Keep dependencies updated** (`pip list --outdated`) and back up the
   database regularly (Render's backups, or a scheduled `pg_dump`).

## Part 3: Accounts (you)

- Use a **different, strong password** (at least 12 characters) for Gmail,
  GitHub, Cloudflare and Render, the accounts that control the site.
- Never share passwords over WhatsApp or email, and change any password
  that has been reused on another site.
- Give admin access only to people who need it; remove it when they leave.
- Don't use "Keep me signed in" on shared computers.

## Optional: lock the external scripts

The site loads Marked, DOMPurify and PDF.js from cdnjs. To make the browser
refuse them if cdnjs were ever tampered with, add `integrity="sha384-…"`
and `crossorigin="anonymous"` to each `<script src="https://cdnjs…">` tag.
cdnjs shows the exact `integrity` value next to each file ("Copy SRI").
