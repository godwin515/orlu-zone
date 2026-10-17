/**
 * Search suggestions (autocomplete) for any search box.
 * Location: js/search-suggest.js
 *
 * Calls GET /search/suggestions as the person types and shows a dropdown of
 * matching posts and events. Works with the keyboard (arrow keys, Enter,
 * Escape) and screen readers (ARIA combobox pattern).
 *
 * Used by the header search box (wired in ui.js) and the search page.
 */

import { api } from "./api.js";
import { escapeHtml, urls } from "./ui.js";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;
const LIMIT = 6;

let uid = 0;

/** @param {HTMLInputElement} input  must sit inside a <form> */
export function attachSuggestions(input) {
  if (!input || input.dataset.suggest === "on") return;
  input.dataset.suggest = "on";

  const form = input.closest("form");
  const listId = `suggest-${++uid}`;
  const list = document.createElement("ul");
  list.id = listId;
  list.className = "suggest";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Suggestions");
  list.hidden = true;
  form.classList.add("has-suggest");
  form.appendChild(list);

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");

  let items = [];
  let active = -1;
  let timer = null;
  let latest = 0;

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const setActive = (index) => {
    const options = list.querySelectorAll('[role="option"]');
    options.forEach((o) => o.setAttribute("aria-selected", "false"));
    active = index;
    if (index >= 0 && options[index]) {
      options[index].setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", options[index].id);
      options[index].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const hrefFor = (s) => (s.type === "event" ? urls.event(s.slug) : urls.post(s.slug));

  const render = (query) => {
    if (!items.length) {
      close();
      return;
    }
    list.innerHTML =
      items
        .map(
          (s, i) => `
        <li role="option" id="${listId}-${i}" aria-selected="false" data-index="${i}">
          <a class="suggest__item" href="${escapeHtml(hrefFor(s))}" tabindex="-1">
            <span class="suggest__type">${s.type === "event" ? "Event" : "News"}</span>
            <span class="suggest__title">${escapeHtml(s.title)}</span>
          </a>
        </li>`,
        )
        .join("") +
      `<li class="suggest__all" role="option" id="${listId}-all" aria-selected="false" data-index="${items.length}">
        <a class="suggest__item" href="${escapeHtml(urls.search(query))}" tabindex="-1">See all results for “${escapeHtml(query)}”</a>
      </li>`;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    active = -1;
  };

  const fetchSuggestions = async (query) => {
    const id = ++latest;
    try {
      const res = await api.suggest(query, { limit: LIMIT });
      if (id !== latest) return; // a newer keystroke already fired
      items = res?.suggestions || [];
      render(query);
    } catch {
      if (id === latest) close(); // suggestions are optional; fail quietly
    }
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < MIN_CHARS) {
      latest++;
      items = [];
      close();
      return;
    }
    timer = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    const count = list.querySelectorAll('[role="option"]').length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((active + 1) % count);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active <= 0 ? count - 1 : active - 1);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      const link = list.querySelectorAll('[role="option"]')[active]?.querySelector("a");
      if (link) window.location.href = link.href;
    } else if (e.key === "Escape") {
      e.preventDefault(); // first Escape closes the suggestions only
      close();
    }
  });

  // Keep the list open while a suggestion is being clicked.
  list.addEventListener("mousedown", (e) => e.preventDefault());
  input.addEventListener("blur", () => setTimeout(close, 100));
  input.addEventListener("focus", () => {
    if (items.length && input.value.trim().length >= MIN_CHARS) render(input.value.trim());
  });
}
