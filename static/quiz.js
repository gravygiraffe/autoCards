// Multiple choice quiz page. QUIZ is set by templates/quiz.html; $, $$, the progress
// helpers and the segmented progress bar come from common.js.
//
// A "round" goes through the questions in `order`. Answers given this round are kept in
// `answers` (so going back shows what was picked), and the result of each checked answer
// is saved to questions/progress.json as that question's most recent result.

const PROGRESS_URL = "api/quiz-progress";

// Answer buttons are styled by the .option components in input.css, from their
// data-state ("idle", "selected", "right", "missed", "wrong" or "dim"). Checked answers
// also get a mark after the text.
const OPTION_MARKS = {
  right: "\u2713",
  missed: "Missed",
  wrong: "\u2717",
};
// Segment colors for this round's results (the rest are in common.js). Tailwind only
// generates classes it can see written out in full, so these are complete class names.
const SEGMENT_COLORS = {
  correct: "bg-emerald-500",
  incorrect: "bg-red-500",
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
    showSaveError(true);
  }
  render();
}

// Questions are identified by their prompt, so rewording a prompt loses its result.
const statusOf = (q) => progress[quiz.id]?.[q.prompt];

function setStatus(q, status) {
  progress[quiz.id] ??= {};
  progress[quiz.id][q.prompt] = status;
  saveProgress(PROGRESS_URL, { quiz: quiz.id, question: q.prompt, status });
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
  if (letters.length === 1) return letters[0];
  return `${letters.slice(0, -1).join(", ")} and ${letters.at(-1)}`;
}

// Pick or unpick an answer. Single-answer questions replace the previous pick.
function toggleOption(key) {
  if (index >= order.length) return;
  const n = order[index];
  const q = quiz.questions[n];
  const a = answerOf(n);
  if (a.checked || !q.options.some((o) => o.key === key)) return;
  if (!isMulti(q)) a.selected = new Set([key]);
  else if (a.selected.has(key)) a.selected.delete(key);
  else a.selected.add(key);
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
// Segments show this round's result for each question (green / red), grey if not answered yet.
function segmentColor(i) {
  const result = resultOf(order[i]);
  if (result) return SEGMENT_COLORS[result];
  return i === index ? SEGMENT_CURRENT : SEGMENT_EMPTY;
}

function renderBar() {
  renderProgressBar({
    total: order.length,
    index,
    colorOf: segmentColor,
    // Nothing left to ask: full green if every question is already correct.
    emptyColor: quiz.questions.length ? SEGMENT_COLORS.correct : SEGMENT_EMPTY,
  });
}

enableScrubbing(() => order.length, jumpTo);

// ---- Rendering ----
// An answer button's data-state (see the .option components in input.css).
function optionState(picked, correct, checked) {
  if (!checked) return picked ? "selected" : "idle";
  if (correct) return picked ? "right" : "missed";
  return picked ? "wrong" : "dim";
}

function renderOptions(q, a) {
  const multi = isMulti(q);
  const buttons = q.options.map((o) => {
    const picked = a.selected.has(o.key);
    const state = optionState(picked, q.correct.includes(o.key), a.checked);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option";
    btn.dataset.state = state;
    btn.disabled = a.checked;
    btn.setAttribute("role", multi ? "checkbox" : "radio");
    btn.setAttribute("aria-checked", String(picked));
    btn.addEventListener("click", () => toggleOption(o.key));

    // The role also makes the letter round ("choose one") or square ("select all that apply").
    const letter = document.createElement("span");
    letter.className = "option-letter";
    letter.textContent = o.key.toUpperCase();

    const text = document.createElement("span");
    text.className = "option-text";
    setRichText(text, o.text);

    btn.append(letter, text);
    if (state in OPTION_MARKS) {
      const mark = document.createElement("span");
      mark.className = "option-mark";
      // With only one right answer, "Missed" reads better as "Correct answer".
      mark.textContent = state === "missed" && !multi ? "Correct answer" : OPTION_MARKS[state];
      btn.append(mark);
    }
    return btn;
  });
  $("options").replaceChildren(...buttons);
}

// The results screen at the end of a round (or when there's nothing to ask).
function renderDone(saved, round) {
  const total = order.length;
  const empty = !quiz.questions.length;
  if (!total) {
    $("done-title").textContent = empty ? "This quiz has no questions yet." : "You've answered every question correctly!";
    $("done-score").textContent = "";
    $("done-summary").textContent = "";
  } else {
    const skipped = total - round.correct - round.incorrect;
    const percent = Math.round((round.correct / total) * 100);
    $("done-title").textContent = "Quiz complete!";
    $("done-score").textContent = `${round.correct} / ${total}`;
    $("done-summary").textContent = skipped ? `${percent}% correct · ${skipped} skipped` : `${percent}% correct`;
  }
  $("review-btn").classList.toggle("hidden", !total);
  $("retry-btn").classList.toggle("hidden", saved.correct === quiz.questions.length);
  $("restart-btn").classList.toggle("hidden", empty);
}

function renderFeedback(q, result) {
  const feedback = $("feedback");
  feedback.dataset.result = result ?? "";
  if (!result) {
    feedback.textContent = "";
  } else if (result === "correct") {
    feedback.textContent = "Correct!";
  } else {
    const answer = isMulti(q) ? "the answers are" : "the answer is";
    feedback.textContent = `Not quite \u2014 ${answer} ${listKeys(q.correct)}.`;
  }
}

function checkButtonLabel(a) {
  if (!a.checked) return "Check";
  if (index < order.length - 1) return "Next";
  return "Results";
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
  if (done) return renderDone(saved, round);

  const n = order[index];
  const q = quiz.questions[n];
  const a = answerOf(n);

  $("question-label").textContent = `Question ${index + 1}`;
  $("question-hint").textContent = isMulti(q) ? "Select all that apply" : "Choose one";
  setRichText($("question-prompt"), q.prompt);
  renderOptions(q, a);
  renderFeedback(q, resultOf(n));

  const checkBtn = $("check-btn");
  checkBtn.textContent = checkButtonLabel(a);
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

function pulse(el) {
  const frames = [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }];
  animate(el, frames, { duration: 320, easing: "ease-out" });
}

function shake(el) {
  const frames = [0, -8, 8, -6, 6, -3, 0].map((x) => ({ transform: `translateX(${x}px)` }));
  animate(el, frames, { duration: 380, easing: "ease-out" });
}

// ---- Actions ----
// Move forward (1) or back (-1). From the results, back returns to the last question.
function go(step) {
  const next = index + step;
  if (next < 0 || next >= order.length) return false;
  index = next;
  showWith("slide", step);
  return true;
}

// Move to any question. Clicks animate; scrubbing (dragging along the bar) jumps instantly.
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

// Start a new round from the first question in `order`.
function restartRound() {
  index = 0;
  answers = new Map();
  showWith("fade");
}

// Choose which questions to ask ("all" or "missed") and start a new round.
function setFilter(value) {
  filter = value;
  highlightFilter(filter);
  order = quiz.questions
    .map((_, n) => n)
    .filter((n) => filter === "all" || statusOf(quiz.questions[n]) !== "correct");
  restartRound();
}

function shuffle() {
  shuffleInPlace(order);
  restartRound();
}

function resetQuiz() {
  if (!confirm(`Reset all progress for "${quiz.title}"?`)) return;
  delete progress[quiz.id];
  saveProgress(PROGRESS_URL, { quiz: quiz.id, reset: true });
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
