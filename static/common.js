// Shared by every page: element helpers, the dark mode button, and progress saving.
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
    else if (text[j] === "$") return !isSpace(text[j - 1]) && !/\d/.test(text[j + 1] ?? "") ? j : -1;
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

// Progress lives in cards/progress.json ("api/progress") and questions/progress.json
// ("api/quiz-progress"). Both throw on failure so the page can show an error.
async function fetchProgress(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

// Send a single change to the server (see apply_update in app.py for the formats).
async function postProgress(url, update) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error(res.statusText);
}
