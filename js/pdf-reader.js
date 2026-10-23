/**
 * A PDF reader that works inside the page on phones.
 * Location: js/pdf-reader.js   (used by js/pages/documents.js)
 *
 * Phone browsers can't show a PDF inside a web page: Android saves it,
 * iPhones open it in a new tab. This draws each page with PDF.js (the free
 * reader made by Mozilla, used in Firefox) so "View" shows the document
 * right on the page and nothing is saved to the phone.
 *
 * PDF.js is loaded from cdnjs the first time someone views a document on a
 * phone, and only then; computers keep using the browser's own PDF viewer.
 */

const PDFJS_VERSION = "3.11.174";
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

let loading = null;

/** Load PDF.js once. Resolves with the library, or rejects if it can't load. */
export function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PDFJS_URL;
    script.async = true;
    script.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) {
        reject(new Error("PDF reader didn't load"));
        return;
      }
      lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      resolve(lib);
    };
    script.onerror = () => reject(new Error("PDF reader didn't load"));
    document.head.appendChild(script);
  }).catch((error) => {
    loading = null; // allow a retry next time
    throw error;
  });
  return loading;
}

/**
 * Show a PDF inside `container`, one page under another, fitted to the width.
 * Pages are drawn as they scroll into view, so long documents open quickly.
 * Returns a controller: { pages, setZoom(factor), destroy() }.
 * @param {HTMLElement} container
 * @param {Blob} blob
 */
export async function renderPdf(container, blob) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = lib.getDocument({ data });
  const pdf = await task.promise;

  container.innerHTML = "";
  const slots = [];
  let zoom = 1;
  let destroyed = false;

  // A placeholder for every page, sized from page 1 so scrolling is stable.
  const first = await pdf.getPage(1);
  const base = first.getViewport({ scale: 1 });
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const slot = document.createElement("div");
    slot.className = "pdf-page";
    slot.style.aspectRatio = `${base.width} / ${base.height}`;
    slot.dataset.page = String(n);
    slot.setAttribute("role", "img");
    slot.setAttribute("aria-label", `Page ${n} of ${pdf.numPages}`);
    container.appendChild(slot);
    slots.push({ el: slot, drawnAt: 0, drawing: null });
  }

  async function draw(slot) {
    const width = Math.round(slot.el.clientWidth);
    if (!width || slot.drawnAt === width || destroyed) return;
    if (slot.drawing) return slot.drawing;
    slot.drawing = (async () => {
      const page = await pdf.getPage(Number(slot.el.dataset.page));
      const unscaled = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      const viewport = page.getViewport({ scale: (width / unscaled.width) * ratio });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      slot.el.style.aspectRatio = `${unscaled.width} / ${unscaled.height}`;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      if (destroyed) return;
      slot.el.replaceChildren(canvas);
      slot.drawnAt = width;
    })()
      .catch(() => {
        slot.el.textContent = "This page couldn't be shown.";
      })
      .finally(() => {
        slot.drawing = null;
      });
    return slot.drawing;
  }

  // Draw pages when they come near the screen.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) draw(slots[Number(entry.target.dataset.page) - 1]);
      }
    },
    { root: container.closest("[data-pdf-scroll]") || null, rootMargin: "600px 0px" },
  );
  slots.forEach((s) => observer.observe(s.el));
  await draw(slots[0]);

  return {
    pages: pdf.numPages,
    /** 1 = fit to width; 1.5 and 2 make pages wider (scroll sideways). */
    setZoom(factor) {
      zoom = factor;
      container.style.setProperty("--pdf-zoom", String(zoom));
      // Redraw what's visible at the new size; the rest redraw as they scroll in.
      requestAnimationFrame(() => {
        const box = (container.closest("[data-pdf-scroll]") || container).getBoundingClientRect();
        slots.forEach((s) => {
          const r = s.el.getBoundingClientRect();
          if (r.bottom > box.top - 600 && r.top < box.bottom + 600) draw(s);
          else s.drawnAt = 0;
        });
      });
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      task.destroy?.();
      container.innerHTML = "";
    },
  };
}
