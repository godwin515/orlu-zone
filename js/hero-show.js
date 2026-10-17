/**
 * Homepage hero pictures: a slow zoom on each picture, cross-fading to the next.
 * Location: js/hero-show.js   (used by js/pages/home.js)
 *
 * The progress line on the current dot is a CSS animation; when it ends,
 * the next picture shows. Pausing just pauses the CSS animations, so the
 * picture, its zoom and the progress all stop together and resume in place.
 *
 * Visitors who ask for reduced motion get no zoom and no automatic change;
 * they can still step through the pictures with the dots.
 * The photos are added as slides in index.html (see the note there).
 */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function initHeroShow(root) {
  if (!root) return;
  const slides = [...root.querySelectorAll(".hero-show__slide")];
  const caption = root.querySelector("[data-hero-caption]");
  const controls = root.querySelector("[data-hero-controls]");
  if (!controls) return;

  // No photos yet: show the plain pattern and hide the caption bar.
  root.classList.toggle("is-empty", slides.length === 0);
  if (slides.length === 0) return;

  // One photo: a slow, endless zoom in and out; no controls. No caption, no caption bar.
  if (slides.length === 1) {
    slides[0].classList.add("is-active");
    const text = slides[0].dataset.caption || "";
    if (caption) caption.textContent = text;
    root.classList.add("is-single");
    root.classList.toggle("no-caption", !text);
    return;
  }

  let current = Math.max(0, slides.findIndex((s) => s.classList.contains("is-active")));
  let pausedByVisitor = false;

  controls.innerHTML = `
    <div class="hero-show__dots">
      ${slides
        .map(
          (s, i) => `
        <button type="button" class="hero-show__dot" data-go="${i}"
          aria-label="Picture ${i + 1} of ${slides.length}${s.dataset.caption ? `: ${escapeAttr(s.dataset.caption)}` : ""}">
          <span class="hero-show__progress"></span>
        </button>`,
        )
        .join("")}
    </div>
    <button type="button" class="hero-show__pause" data-pause aria-label="Pause the pictures">
      <svg viewBox="0 0 16 16" aria-hidden="true" class="icon-pause"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>
      <svg viewBox="0 0 16 16" aria-hidden="true" class="icon-play"><path d="M4 2.5v11a.8.8 0 0 0 1.2.7l9-5.5a.8.8 0 0 0 0-1.4l-9-5.5A.8.8 0 0 0 4 2.5z"/></svg>
    </button>`;

  const dots = [...controls.querySelectorAll(".hero-show__dot")];
  const pauseButton = controls.querySelector("[data-pause]");

  function show(index) {
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      const active = i === current;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", String(!active));
      if (active) restartAnimation(slide.querySelector("img"));
    });
    dots.forEach((dot, i) => {
      const active = i === current;
      dot.classList.toggle("is-active", active);
      if (active) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
      if (active) restartAnimation(dot.querySelector(".hero-show__progress"));
    });
    if (caption) caption.textContent = slides[current].dataset.caption || "";
  }

  function setPaused(paused) {
    root.classList.toggle("is-paused", paused);
  }

  // The current dot's progress line finishing means "time for the next picture".
  controls.addEventListener("animationend", (e) => {
    if (e.target.classList.contains("hero-show__progress") && dots[current]?.contains(e.target)) {
      show(current + 1);
    }
  });

  controls.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) {
      show(Number(go.dataset.go));
      return;
    }
    if (e.target.closest("[data-pause]")) {
      pausedByVisitor = !pausedByVisitor;
      pauseButton.setAttribute("aria-label", pausedByVisitor ? "Play the pictures" : "Pause the pictures");
      pauseButton.classList.toggle("is-playing", !pausedByVisitor);
      root.classList.toggle("is-stopped", pausedByVisitor);
      setPaused(pausedByVisitor);
    }
  });

  // Hold still while someone is moving through the controls with the keyboard
  // (a mouse click also focuses the button, so only count keyboard focus).
  root.addEventListener("focusin", (e) => {
    if (e.target.matches(":focus-visible")) setPaused(true);
  });
  root.addEventListener("focusout", () =>
    setTimeout(() => setPaused(pausedByVisitor || Boolean(root.querySelector(":focus-visible")))),
  );

  const applyMotion = () => {
    root.classList.toggle("is-static", reduceMotion.matches);
    pauseButton.hidden = reduceMotion.matches;
  };
  reduceMotion.addEventListener?.("change", applyMotion);
  applyMotion();

  pauseButton.classList.add("is-playing");
  show(current);
}

function restartAnimation(el) {
  if (!el) return;
  el.style.animation = "none";
  void el.offsetWidth; // reflow so the animation starts again from 0
  el.style.animation = "";
}

function escapeAttr(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
