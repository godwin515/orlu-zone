/**
 * Working email links on every page.
 * Location: js/email-chooser.js   (started by renderShell() in js/ui.js)
 *
 * A plain "mailto:" link only works when the visitor's device has an email
 * app set up; on many computers it does nothing. So any email link on the
 * site opens a small menu instead:
 *   - Gmail, Outlook or Yahoo Mail in the browser (a new message, ready to send)
 *   - the device's email app (the normal mailto: link)
 *   - copy the address
 * Ctrl/Cmd-click and middle-click still open the plain link.
 */

const SUBJECT = "Enquiry from the Orlu Zone website";

let dialog = null;
let returnFocus = null;

const ICON = {
  gmail: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#ea4335" d="M3.5 6.6 12 13l8.5-6.4V18a1.5 1.5 0 0 1-1.5 1.5h-2.3V10.4L12 14 7.3 10.4v9.1H5A1.5 1.5 0 0 1 3.5 18z"/><path fill="#fbbc04" d="M20.5 6.6V6a1.5 1.5 0 0 0-2.4-1.2L12 9.4 5.9 4.8A1.5 1.5 0 0 0 3.5 6v.6L12 13z"/></svg>`,
  outlook: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="12" height="14" rx="2" fill="#0a64c4"/><ellipse cx="8.5" cy="12" rx="3" ry="3.6" fill="none" stroke="#fff" stroke-width="1.8"/><path fill="#28a8ea" d="M15.5 8h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5z"/><path fill="none" stroke="#fff" stroke-width="1.2" d="m15.5 9.5 3 2.2 3-2.2"/></svg>`,
  yahoo: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#6001d2"/><path fill="#fff" d="M6.2 8.5h2.6l1.6 4 1.6-4h2.5L11.6 15v3h-2.4v-3zM15.6 8.5h2.6l-1.9 4.8h-2.1zM14.2 14.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z"/></svg>`,
  app: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`,
};

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function optionsFor(email) {
  const to = encodeURIComponent(email);
  const su = encodeURIComponent(SUBJECT);
  return [
    { key: "gmail", label: "Gmail", note: "Opens in your browser", href: `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${su}` },
    { key: "outlook", label: "Outlook / Hotmail", note: "Opens in your browser", href: `https://outlook.live.com/mail/0/deeplink/compose?to=${to}&subject=${su}` },
    { key: "yahoo", label: "Yahoo Mail", note: "Opens in your browser", href: `https://compose.mail.yahoo.com/?to=${to}&subject=${su}` },
    { key: "app", label: "Email app", note: "Mail, Outlook app or your phone's email", href: `mailto:${email}?subject=${su}`, app: true },
  ];
}

function build() {
  dialog = document.createElement("dialog");
  dialog.className = "email-chooser";
  dialog.setAttribute("aria-labelledby", "email-chooser-title");
  document.body.appendChild(dialog);

  dialog.addEventListener("click", async (e) => {
    if (e.target === dialog || e.target.closest("[data-email-close]")) {
      dialog.close();
      return;
    }
    const copy = e.target.closest("[data-email-copy]");
    if (copy) {
      const email = copy.dataset.emailCopy;
      let ok = false;
      try {
        await navigator.clipboard.writeText(email);
        ok = true;
      } catch {
        // Older browsers: select the address so it can be copied by hand.
        const field = dialog.querySelector("[data-email-address]");
        const range = document.createRange();
        range.selectNodeContents(field);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        ok = document.execCommand?.("copy") ?? false;
      }
      const label = copy.querySelector("[data-copy-label]");
      label.textContent = ok ? "Copied!" : "Press Ctrl+C to copy";
      copy.classList.toggle("is-copied", ok);
      setTimeout(() => {
        label.textContent = "Copy email address";
        copy.classList.remove("is-copied");
      }, 2200);
      return;
    }
    // A web-mail or app choice: let the link open, then close the menu.
    if (e.target.closest("[data-email-option]")) setTimeout(() => dialog.close(), 150);
  });

  dialog.addEventListener("close", () => returnFocus?.focus());
  return dialog;
}

function open(email, trigger) {
  const box = dialog || build();
  returnFocus = trigger;
  box.innerHTML = `
    <div class="email-chooser__panel">
      <button type="button" class="email-chooser__close" data-email-close aria-label="Close">&times;</button>
      <p class="email-chooser__kicker">Send us an email</p>
      <h2 class="email-chooser__title" id="email-chooser-title">How would you like to send it?</h2>
      <p class="email-chooser__address" data-email-address>${escapeHtml(email)}</p>
      <ul class="email-chooser__list">
        ${optionsFor(email)
          .map(
            (o) => `
          <li>
            <a class="email-chooser__option" href="${escapeHtml(o.href)}" data-email-option
              ${o.app ? "" : 'target="_blank" rel="noopener"'}>
              <span class="email-chooser__icon">${ICON[o.key]}</span>
              <span class="email-chooser__text"><strong>${escapeHtml(o.label)}</strong><span>${escapeHtml(o.note)}</span></span>
              <span class="email-chooser__arrow" aria-hidden="true">→</span>
            </a>
          </li>`,
          )
          .join("")}
        <li>
          <button type="button" class="email-chooser__option" data-email-copy="${escapeHtml(email)}">
            <span class="email-chooser__icon">${ICON.copy}</span>
            <span class="email-chooser__text"><strong data-copy-label>Copy email address</strong><span>Paste it into any email service</span></span>
          </button>
        </li>
      </ul>
    </div>`;
  box.showModal();
  box.querySelector(".email-chooser__option")?.focus();
}

let started = false;

/** Make every email link on the page open the chooser. Safe to call more than once. */
export function initEmailChooser() {
  if (started) return;
  started = true;
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href^="mailto:"]');
    if (!link || link.hasAttribute("data-email-option")) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const email = decodeURIComponent(link.getAttribute("href").slice(7).split("?")[0]).trim();
    if (!email) return;
    e.preventDefault();
    open(email, link);
  });
}
