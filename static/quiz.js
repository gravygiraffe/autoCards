// Multiple choice quiz page. QUIZ is set by templates/quiz.html; $, $$, fetchProgress and
// postProgress come from common.js.
//
// A "round" goes through the questions in `order`. Answers given this round are kept in
// `answers` (so going back shows what was picked), and the result of each checked answer
// is saved to questions/progress.json as that question's most recent result.

const PROGRESS_URL = "api/quiz-progress";

// Tailwind only generates classes it can see written out in the templates and scripts,
// so every class that JavaScript adds is spelled out in full here.
const OPTION_BASE = "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[0.9375rem] font-medium shadow transition-colors dark:shadow-black/30";
const OPTION_STYLES = {
  // Before checking
  idle: {
    button: "cursor-pointer bg-white outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:focus-visible:ring-neutral-400",
    letter: "bg-slate-100 text-slate-600 dark:bg-neutral-700 dark:text-neutral-300",
  },
  selected: {
    button: "cursor-pointer bg-indigo-50 outline-none ring-2 ring-indigo-500 dark:bg-neutral-700 dark:ring-neutral-300",
    letter: "bg-indigo-600 text-white dark:bg-neutral-200 dark:text-neutral-900",
  },
  // After checking
  right: {
    button: "bg-emerald-100 text-emerald-800 ring-2 ring-emerald-500 dark:bg-emerald-400/20 dark:text-emerald-300 dark:ring-emerald-400",
    letter: "bg-emerald-500 text-white",
    mark: "\u2713",
  },
  missed: {
    button: "bg-emerald-50 text-emerald-800 outline-2 outline-offset-0 outline-dashed outline-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-300 dark:outline-emerald-400",
    letter: "bg-emerald-500 text-white",
    mark: "Missed",
  },
  wrong: {
    button: "bg-red-100 text-red-800 ring-2 ring-red-500 dark:bg-red-400/20 dark:text-red-300 dark:ring-red-400",
    letter: "bg-red-500 text-white",
    mark: "\u2717",
  },
  dim: {
    button: "bg-white opacity-50 dark:bg-neutral-800",
    letter: "bg-slate-100 text-slate-600 dark:bg-neutral-700 dark:text-neutral-300",
  },
};
const FEEDBACK_COLORS = {
  correct: "text-emerald-700 dark:text-emerald-300",
  incorrect: "text-red-600 dark:text-red-400",
};
const SEGMENT_COLORS = {
  correct: "bg-emerald-500",
  incorrect: "bg-red-500",
  current: "bg-slate-400 dark:bg-neutral-400",
  empty: "bg-slate-200 dark:bg-neutral-700",
};

const quiz = QUIZ;

let progress = {};        // same shape as questions/progress.json: { quizId: { prompt: "correct" | "incorrect" } }
let order = [];           // positions in quiz.questions, in the order asked (after filtering / shuffling)
let index = 0;            // position in `order`; equal to order.length once the results are showing
let filter = "all";       // "all" or "missed" (questions whose last answer wasn't correct)
let answers = new Map();  // this round: question position -> { selected: Set of keys, checked: bool }

// ---- Progress (stored in questions/progress.json by app.py) ----
async function loadProgress() {
  try {
    progress = await fetchProgress(PROGRESS_URL);
  } catch {
    $("save-error").classList.remove("hidden");
  }
  render();
}

// The page updates `progress` itself right away rather than waiting for this to finish.
async function persist(update) {
  try {
    await postProgress(PROGRESS_URL, update);
    $("save-error").classList.add("hidden");
  } catch {
    $("save-error").classList.remove("hidden");
  }
}

// Questions are identified by their prompt, so rewording a prompt loses its result.
const statusOf = (q) => progress[quiz.id]?.[q.prompt];

function setStatus(q, status) {
  (progress[quiz.id] ??= {})[q.prompt] = status;
  persist({ quiz: quiz.id, question: q.prompt, status });
}

function savedCounts() {
  const counts = { correct: 0, incorrect: 0 };
  for (const q of quiz.questions) {
    const s = statusOf(q);
    if (s in counts) counts[s]++;
  }
  return counts;
}

// This round's results: { correct, incorrect } over the questions checked so far.
function roundCounts() {
  const counts = { correct: 0, incorrect: 0 };
  for (const n of order) {
    const r = resultOf(n);
    if (r) counts[r]++;
  }
  return counts;
}

// ---- Answers ----
const isMulti = (q) => q.correct.length > 1;
const answerOf = (n) => answers.get(n) ?? { selected: new Set(), checked: false };

// "correct" / "incorrect" once a question has been checked this round, otherwise undefined.
function resultOf(n) {
  const a = answers.get(n);
  if (!a?.checked) return undefined;
  const q = quiz.questions[n];
  const right = a.selected.size === q.correct.length && q.correct.every((k) => a.selected.has(k));
  return right ? "correct" : "incorrect";
}

// "B", "A and C", "A, C and D"
function listKeys(keys) {
  const letters = keys.map((k) => k.toUpperCase());
  return letters.length > 1 ? `${letters.slice(0, -1).join(", ")} and ${letters.at(-1)}` : letters[0];
}

// Pick or unpick an answer. Single-answer questions replace the previous pick.
function toggleOption(key) {
  if (index >= order.length) return;
  const n = order[index];
  const q = quiz.questions[n];
  const a = answerOf(n);
  if (a.checked || !q.options.some((o) => o.key === key)) return;
  if (isMulti(q)) {
    if (a.selected.has(key)) a.selected.delete(key);
    else a.selected.add(key);
  } else {
    a.selected = new Set([key]);
  }
  answers.set(n, a);
  render();
}

function check() {
  const n = order[index];
  const a = answerOf(n);
  if (a.checked || !a.selected.size) return;
  a.checked = true;
  answers.set(n, a);
  const result = resultOf(n);
  setStatus(quiz.questions[n], result);
  render();
  if (result === "correct") pulse($("question-card"));
  else shake($("options"));
}

// The main button: check the answer, then move on (or show the results after the last question).
function primaryAction() {
  if (index >= order.length) return;
  if (!answerOf(order[index]).checked) return check();
  if (index < order.length - 1) return go(1);
  finish();
}

// ---- Segmented progress bar ----
const bar = $("progress-bar");

// Segments show this round's result for each question (green / red), grey if not
// answered yet. The current question's segment is drawn taller.
function renderBar() {
  const total = order.length;
  $("progress").textContent = `${Math.min(index + 1, total)} / ${total}`;
  if (!total) {
    const color = quiz.questions.length ? SEGMENT_COLORS.correct : SEGMENT_COLORS.empty;
    bar.replaceChildren(Object.assign(document.createElement("span"), { className: `h-2 flex-1 rounded-full ${color}` }));
    return;
  }
  bar.style.gap = total > 100 ? "0px" : total > 40 ? "1px" : "3px";
  if (bar.children.length !== total) {
    bar.replaceChildren(...Array.from({ length: total }, () => document.createElement("span")));
  }
  const shape = total > 100 ? "" : "rounded-full";
  [...bar.children].forEach((segment, i) => {
    const color = SEGMENT_COLORS[resultOf(order[i])] ?? (i === index ? SEGMENT_COLORS.current : SEGMENT_COLORS.empty);
    segment.className = `min-w-0 flex-1 transition-all duration-200 ${shape} ${i === index ? "h-3.5" : "h-2"} ${color}`;
  });
  bar.setAttribute("aria-valuemin", "1");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(Math.min(index + 1, total)));
}

function barIndexAt(clientX) {
  const rect = bar.getBoundingClientRect();
  const i = Math.floor(((clientX - rect.left) / rect.width) * order.length);
  return Math.max(0, Math.min(order.length - 1, i));
}

// Click a segment to jump to that question, or drag along the bar to scrub through them.
let scrubbing = false;
bar.addEventListener("pointerdown", (e) => {
  if (!order.length) return;
  scrubbing = true;
  bar.setPointerCapture(e.pointerId);
  jumpTo(barIndexAt(e.clientX), true);
});
bar.addEventListener("pointermove", (e) => {
  if (scrubbing) jumpTo(barIndexAt(e.clientX), false);
});
bar.addEventListener("pointerup", () => (scrubbing = false));
bar.addEventListener("pointercancel", () => (scrubbing = false));

// ---- Rendering ----
function renderOptions(q, a) {
  const multi = isMulti(q);
  const buttons = q.options.map((o) => {
    const picked = a.selected.has(o.key);
    const correct = q.correct.includes(o.key);
    let state;
    if (!a.checked) state = picked ? "selected" : "idle";
    else if (correct) state = picked ? "right" : "missed";
    else state = picked ? "wrong" : "dim";
    const style = OPTION_STYLES[state];

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${OPTION_BASE} ${style.button}`;
    btn.disabled = a.checked;
    btn.setAttribute("role", multi ? "checkbox" : "radio");
    btn.setAttribute("aria-checked", String(picked));
    btn.addEventListener("click", () => toggleOption(o.key));

    // Round letters for "choose one", square ones for "select all that apply".
    const letter = document.createElement("span");
    letter.className = `flex size-8 shrink-0 items-center justify-center text-sm font-semibold ${multi ? "rounded-md" : "rounded-full"} ${style.letter}`;
    letter.textContent = o.key.toUpperCase();

    const text = document.createElement("span");
    text.className = "min-w-0 flex-1 break-words whitespace-pre-line";
    setRichText(text, o.text);

    btn.append(letter, text);
    if (style.mark) {
      const mark = document.createElement("span");
      mark.className = "shrink-0 text-sm font-semibold";
      mark.textContent = state === "missed" && !multi ? "Correct answer" : style.mark;
      btn.append(mark);
    }
    return btn;
  });
  $("options").replaceChildren(...buttons);
}

// Update the whole page to match the current state. Called after every change.
function render() {
  const saved = savedCounts();
  const unanswered = quiz.questions.length - saved.correct - saved.incorrect;
  $("quiz-counts").textContent = `${saved.correct} correct · ${saved.incorrect} incorrect · ${unanswered} not answered yet`;
  const round = roundCounts();
  $("score").textContent = order.length ? `${round.correct} correct · ${round.incorrect} incorrect` : "";
  renderBar();

  const total = order.length;
  const done = index >= total;
  $("study").classList.toggle("hidden", done);
  $("done").classList.toggle("hidden", !done);

  if (done) {
    const empty = !quiz.questions.length;
    const answered = round.correct + round.incorrect;
    const skipped = total - answered;
    const notCorrect = quiz.questions.length - saved.correct;
    if (!total) {
      $("done-title").textContent = empty ? "This quiz has no questions yet." : "You've answered every question correctly!";
      $("done-score").textContent = "";
      $("done-summary").textContent = "";
    } else {
      $("done-title").textContent = "Quiz complete!";
      $("done-score").textContent = `${round.correct} / ${total}`;
      $("done-summary").textContent =
        `${Math.round((round.correct / total) * 100)}% correct` + (skipped ? ` · ${skipped} skipped` : "");
    }
    $("review-btn").classList.toggle("hidden", !total);
    $("retry-btn").classList.toggle("hidden", notCorrect === 0);
    $("restart-btn").classList.toggle("hidden", empty);
    return;
  }

  const n = order[index];
  const q = quiz.questions[n];
  const a = answerOf(n);
  const result = resultOf(n);

  $("question-label").textContent = `Question ${index + 1}`;
  $("question-hint").textContent = isMulti(q) ? "Select all that apply" : "Choose one";
  setRichText($("question-prompt"), q.prompt);
  renderOptions(q, a);

  const feedback = $("feedback");
  feedback.classList.remove(...FEEDBACK_COLORS.correct.split(" "), ...FEEDBACK_COLORS.incorrect.split(" "));
  if (result) {
    feedback.classList.add(...FEEDBACK_COLORS[result].split(" "));
    const answer = q.correct.length > 1 ? `the answers are ${listKeys(q.correct)}` : `the answer is ${listKeys(q.correct)}`;
    feedback.textContent = result === "correct" ? "Correct!" : `Not quite \u2014 ${answer}.`;
  } else {
    feedback.textContent = "";
  }

  const checkBtn = $("check-btn");
  checkBtn.textContent = !a.checked ? "Check" : index < total - 1 ? "Next" : "Results";
  checkBtn.disabled = !a.checked && !a.selected.size;
  $("prev-btn").disabled = index === 0;
  $("next-btn").disabled = index === total - 1;
}

// ---- Animations ----
const stage = $("question-stage");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

function animate(el, frames, options) {
  if (reduceMotion.matches) return;
  el.getAnimations().forEach((anim) => anim.cancel());
  el.animate(frames, options);
}

// Render the new state, then bring it in: "slide" from the side (dir -1 / 1) or "fade".
function showWith(type, dir = 0) {
  render();
  const target = index >= order.length ? $("done") : stage;
  const from = type === "slide" ? `translateX(${dir * 35}%)` : "scale(0.96)";
  animate(target, [{ transform: from, opacity: 0 }, { transform: "none", opacity: 1 }], {
    duration: 260,
    easing: "cubic-bezier(.2,.8,.2,1)",
  });
}

const pulse = (el) => animate(el, [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }], { duration: 320, easing: "ease-out" });
const shake = (el) =>
  animate(el, [0, -8, 8, -6, 6, -3, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 380, easing: "ease-out" });

// ---- Actions ----
function goHome() {
  location.href = $("back-btn").href;
}

// Move forward (1) or back (-1). From the results, back returns to the last question.
function go(step) {
  const next = index + step;
  if (next < 0 || next >= order.length) return false;
  index = next;
  showWith("slide", step);
  return true;
}

function jumpTo(target, animated) {
  if (target === index || target < 0 || target >= order.length) return;
  const dir = Math.sign(target - index);
  index = target;
  if (animated) showWith("slide", dir);
  else render();
}

function finish() {
  index = order.length;
  showWith("fade");
}

// Choose which questions to ask ("all" or "missed") and start a new round.
function setFilter(value) {
  filter = value;
  $$(".filter-btn").forEach((btn) => {
    const active = btn.dataset.filter === filter;
    ["bg-white", "text-slate-900", "shadow", "dark:bg-neutral-600", "dark:text-white"].forEach((cls) =>
      btn.classList.toggle(cls, active)
    );
  });
  order = quiz.questions
    .map((_, n) => n)
    .filter((n) => filter === "all" || statusOf(quiz.questions[n]) !== "correct");
  index = 0;
  answers = new Map();
  showWith("fade");
}

// Shuffle the question order (Fisher-Yates) and start a new round.
function shuffle() {
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  index = 0;
  answers = new Map();
  showWith("fade");
}

function resetQuiz() {
  if (!confirm(`Reset all progress for "${quiz.title}"?`)) return;
  delete progress[quiz.id];
  persist({ quiz: quiz.id, reset: true });
  setFilter("all");
}

// ---- Events ----
$$(".filter-btn").forEach((btn) => btn.addEventListener("click", () => setFilter(btn.dataset.filter)));
$("check-btn").addEventListener("click", primaryAction);
$("prev-btn").addEventListener("click", () => go(-1));
$("next-btn").addEventListener("click", () => go(1));
$("shuffle-btn").addEventListener("click", shuffle);
$("review-btn").addEventListener("click", () => jumpTo(0, true));
$("retry-btn").addEventListener("click", () => setFilter("missed"));
$("restart-btn").addEventListener("click", () => setFilter("all"));
$("reset-btn").addEventListener("click", resetQuiz);

// Keyboard shortcuts (ignored with Ctrl / Cmd / Alt held).
//   a-j or 1-9  pick an answer     Enter / Space  check, then next
//   ← / →       previous / next    Esc            back to the home page
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (/^[a-j]$/.test(key)) return toggleOption(key);
  if (/^[1-9]$/.test(key)) {
    const q = quiz.questions[order[index]];
    const option = q?.options[Number(key) - 1];
    if (option) toggleOption(option.key);
    return;
  }
  switch (e.key) {
    case "ArrowLeft":
      go(-1);
      break;
    case "ArrowRight":
      go(1);
      break;
    case "Escape":
      goHome();
      break;
    case "Enter":
    case " ":
      // Let Enter / Space work normally on links and the other buttons.
      if (e.target.closest("a, button:not(#options button)")) return;
      e.preventDefault();
      primaryAction();
      break;
  }
});

setFilter("all");
loadProgress();
