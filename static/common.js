// Shared by every page: element helpers, the dark mode button, LaTeX and progress saving,
// plus the pieces the two study pages (cards.js and quiz.js) have in common.
// Loaded before the page's own script (home.js, cards.js or quiz.js).

const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);

// The theme itself is applied by the small script in each page's <head>, before drawing.
$("theme-btn").addEventListener("click", () => {
  const dark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("theme", dark ? "dark" : "light");
});

// ---- LaTeX ----
// Card and quiz text can contain LaTeX, rendered with KaTeX (static/katex/):
//   $...$    inline math
//   $$...$$  display math (centered on its own line)
//   \$       a literal dollar sign
// So that prices like "$10 and $15" stay plain text, a single $ only opens math when the
// next character isn't a space, and only closes it when the previous character isn't a
// space and the next isn't a digit.

const isSpace = (ch) => ch === undefined || /\s/.test(ch);

// Index of the "$$" closing display math that starts at `start`, or -1.
function findDisplayEnd(text, start) {
  for (let j = start; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text.startsWith("$$", j)) return j > start ? j : -1;
  }
  return -1;
}

// Index of the "$" closing inline math that starts at `start`, or -1.
function findInlineEnd(text, start) {
  if (isSpace(text[start]) || text[start] === "$") return -1;
  for (let j = start; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "$") {
      const closes = !isSpace(text[j - 1]) && !/\d/.test(text[j + 1] ?? "");
      return closes ? j : -1;
    }
  }
  return -1;
}

// Split text into [{ text }, { math, display }, ...].
function splitMath(text) {
  const parts = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && text[i + 1] === "$") {
      plain += "$";
      i += 2;
      continue;
    }
    if (text[i] === "$") {
      const display = text[i + 1] === "$";
      const open = display ? 2 : 1;
      const end = display ? findDisplayEnd(text, i + 2) : findInlineEnd(text, i + 1);
      if (end !== -1) {
        // Display math is already on its own line, so drop one line break on either side of it.
        if (display) plain = plain.replace(/\n$/, "");
        if (plain) parts.push({ text: plain });
        plain = "";
        parts.push({ math: text.slice(i + open, end), display });
        i = end + open;
        if (display && text[i] === "\n") i++;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  if (plain) parts.push({ text: plain });
  return parts;
}

// Use instead of el.textContent = text for anything that may contain LaTeX.
// Mistakes in the LaTeX are shown in red rather than breaking the page.
function setRichText(el, text) {
  el.replaceChildren(
    ...splitMath(text).map((part) => {
      if (part.text !== undefined) return document.createTextNode(part.text);
      const span = document.createElement("span");
      if (window.katex) {
        katex.render(part.math, span, { displayMode: part.display, throwOnError: false });
      } else {
        span.textContent = part.display ? `$$${part.math}$$` : `$${part.math}$`;
      }
      return span;
    })
  );
}

// ---- Progress ----
// Progress lives in cards/progress.json ("api/progress") and questions/progress.json
// ("api/quiz-progress"). Throws on failure so the page can show an error.
async function fetchProgress(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

// The study pages show #save-error while progress can't be loaded or saved.
function showSaveError(failed) {
  $("save-error").classList.toggle("hidden", !failed);
}

// Send a single change to the server (see apply_update in app.py for the formats).
// Pages update their own copy of the progress right away rather than waiting for this.
async function saveProgress(url, update) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!res.ok) throw new Error(res.statusText);
    showSaveError(false);
  } catch {
    showSaveError(true);
  }
}

// ---- Study pages ----
function goHome() {
  location.href = $("back-btn").href;
}

// Fisher-Yates shuffle, in place.
function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

// Highlight the .filter-btn whose data-filter matches (styled through aria-pressed).
function highlightFilter(value) {
  $$(".filter-btn").forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.filter === value)));
}

// ---- Segmented progress bar ----
// #progress-bar has one segment per card / question, with the current one drawn taller,
// and #progress shows the position as "3 / 20".
const SEGMENT_CURRENT = "bg-slate-400 dark:bg-neutral-400";
const SEGMENT_EMPTY = "bg-slate-200 dark:bg-neutral-700";

// Shrink the gaps on long bars so the segments still fit.
function segmentGap(total) {
  if (total > 100) return "0px";
  if (total > 40) return "1px";
  return "3px";
}

//   total:      number of segments
//   index:      the current position (may equal total once a round is finished)
//   colorOf:    (i) => color classes for segment i
//   emptyColor: color of the single full-width bar shown when there are no segments
function renderProgressBar({ total, index, colorOf, emptyColor }) {
  const bar = $("progress-bar");
  const position = Math.min(index + 1, total);
  $("progress").textContent = `${position} / ${total}`;
  if (!total) {
    bar.replaceChildren(Object.assign(document.createElement("span"), { className: `h-2 flex-1 rounded-full ${emptyColor}` }));
    return;
  }

  bar.style.gap = segmentGap(total);
  // Only rebuild the segment elements when the number of segments changes.
  if (bar.children.length !== total) {
    bar.replaceChildren(...Array.from({ length: total }, () => document.createElement("span")));
  }
  const shape = total > 100 ? "" : "rounded-full";
  [...bar.children].forEach((segment, i) => {
    const height = i === index ? "h-3.5" : "h-2";
    segment.className = `min-w-0 flex-1 transition-all duration-200 ${shape} ${height} ${colorOf(i)}`;
  });
  bar.setAttribute("aria-valuemin", "1");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(position));
}

// Click a segment to jump to it, or drag along the bar to scrub through them.
// count() is the current number of segments; jumpTo(i, animated) moves there.
function enableScrubbing(count, jumpTo) {
  const bar = $("progress-bar");
  let scrubbing = false;

  // Which segment a point on the bar corresponds to (works in the gaps between segments too).
  const indexAt = (clientX) => {
    const rect = bar.getBoundingClientRect();
    const i = Math.floor(((clientX - rect.left) / rect.width) * count());
    return Math.max(0, Math.min(count() - 1, i));
  };

  bar.addEventListener("pointerdown", (e) => {
    if (!count()) return;
    scrubbing = true;
    bar.setPointerCapture(e.pointerId);
    jumpTo(indexAt(e.clientX), true);
  });
  bar.addEventListener("pointermove", (e) => {
    if (scrubbing) jumpTo(indexAt(e.clientX), false);
  });
  bar.addEventListener("pointerup", () => (scrubbing = false));
  bar.addEventListener("pointercancel", () => (scrubbing = false));
}
