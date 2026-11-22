// Flashcard study page. DECK is set by templates/cards.html; $, $$, the progress
// helpers and the segmented progress bar come from common.js.

// Shown on the card's badge and on the tint while swiping. Their colors come from
// .card-badge[data-status] and .swipe-tint[data-tint] in input.css.
const STATUS_LABELS = {
  got: "Got it",
  learning: "Still learning",
};
const PROGRESS_URL = "api/progress";

const deck = DECK;
const card = $("card");

let progress = {};      // same shape as cards/progress.json: { deckId: { cardFront: "got" | "learning" } }
let order = [];         // positions in deck.cards, in study order (after filtering / shuffling)
let index = 0;          // position in `order`; equal to order.length once a tracked round is finished
let flipped = false;    // showing the back of the card?
let filter = "all";     // "all" or "todo" (cards not marked "got it")
let undoStack = [];     // marks made this round: { index, card, previous, status }
let tracking = document.documentElement.classList.contains("tracking");

// ---- Progress (stored in cards/progress.json by app.py) ----
async function loadProgress() {
  try {
    progress = await fetchProgress(PROGRESS_URL);
  } catch {
    showSaveError(true);
  }
  render();
}

// Cards are identified by their front text, so rewording a front loses its mark.
const statusOf = (c) => progress[deck.id]?.[c.front];

// Set (or clear, with a falsy status) a card's mark and save it.
function setStatus(c, status) {
  progress[deck.id] ??= {};
  const deckProgress = progress[deck.id];
  if (status) deckProgress[c.front] = status;
  else delete deckProgress[c.front];
  if (!Object.keys(deckProgress).length) delete progress[deck.id];
  saveProgress(PROGRESS_URL, { deck: deck.id, card: c.front, status: status || null });
}

function countStatuses() {
  const counts = { got: 0, learning: 0 };
  for (const c of deck.cards) {
    const s = statusOf(c);
    if (s in counts) counts[s]++;
  }
  return counts;
}

const describeCounts = (counts) => `${counts.got} got it · ${counts.learning} still learning`;

// ---- Study view ----
// Turning tracking on or off just toggles the .tracking class; the markup's tracking:
// classes swap which controls are shown. The choice is remembered in localStorage.
function setTracking(value) {
  tracking = value;
  document.documentElement.classList.toggle("tracking", tracking);
  localStorage.setItem("trackLearning", tracking ? "on" : "off");
  $("track-btn").setAttribute("aria-checked", String(tracking));
  if (!tracking && filter !== "all") return setFilter("all");
  undoStack = [];
  index = Math.min(index, Math.max(order.length - 1, 0));
  render();
}

function setFlipped(value) {
  flipped = value;
  card.classList.toggle("rotate-x-180", flipped);
}

// Show the front of a new card without playing the flip animation.
function resetFlip() {
  card.style.transition = "none";
  setFlipped(false);
  card.offsetHeight; // force the browser to apply the change before transitions come back
  card.style.transition = "";
}

// Choose which cards to study ("all" or "todo") and start again from the first one.
function setFilter(value) {
  filter = value;
  highlightFilter(filter);
  order = deck.cards
    .map((_, n) => n)
    .filter((n) => filter === "all" || statusOf(deck.cards[n]) !== "got");
  index = 0;
  undoStack = [];
  animateTo({ enter: { type: "fade" } });
}

// ---- Segmented progress bar ----
// Segment colors for this page (the rest are in common.js). Tailwind only generates
// classes it can see written out in full, so these are complete class names.
const SEGMENT_COLORS = {
  got: "bg-emerald-500",
  learning: "bg-amber-400",
  seen: "bg-indigo-500 dark:bg-neutral-300",
};

// Browsing: segments up to the current card are filled in.
// Tracking: segments show each card's mark (green / amber), grey if unmarked.
function segmentColor(i) {
  if (!tracking) return i <= index ? SEGMENT_COLORS.seen : SEGMENT_EMPTY;
  const status = statusOf(deck.cards[order[i]]);
  if (status) return SEGMENT_COLORS[status];
  return i === index ? SEGMENT_CURRENT : SEGMENT_EMPTY;
}

function renderBar() {
  renderProgressBar({
    total: order.length,
    index,
    colorOf: segmentColor,
    // No cards left to study (every card is "got it"): show one full green bar.
    emptyColor: deck.cards.length ? SEGMENT_COLORS.got : SEGMENT_EMPTY,
  });
}

// Move to any card. Clicks animate; scrubbing (dragging along the bar) jumps instantly.
function jumpTo(target, animated) {
  if (target === index || target < 0 || target >= order.length) return;
  const dir = Math.sign(target - index);
  index = target;
  if (animated) {
    animateTo({ exit: -dir, enter: { type: "slide", dir } });
  } else {
    settleAnimations();
    render();
  }
}

enableScrubbing(() => order.length, jumpTo);

// ---- Rendering ----
// "Done" means a tracked round just finished, or the "Not got yet" filter left no cards.
function doneTitle() {
  if (!deck.cards.length) return "This deck has no cards yet.";
  if (order.length) return "Round complete!";
  return "You've got every card in this deck!";
}

function renderDone(counts) {
  const empty = !deck.cards.length;
  $("done-title").textContent = doneTitle();
  $("done-summary").textContent = empty ? "" : describeCounts(counts);
  $("study-todo-btn").classList.toggle("hidden", counts.got === deck.cards.length);
  $("restart-btn").classList.toggle("hidden", empty);
}

// Update the whole study view to match the current state. Called after every change
// (usually through animateTo, which times it to happen between the swipe out and in).
function render() {
  const counts = countStatuses();
  $("deck-counts").textContent = describeCounts(counts);
  $$(".undo-btn").forEach((btn) => (btn.disabled = undoStack.length === 0));
  renderBar();

  const total = order.length;
  const done = index >= total;
  $("study").classList.toggle("hidden", done);
  $("done").classList.toggle("hidden", !done);

  if (done) return renderDone(counts);

  const current = deck.cards[order[index]];
  const status = tracking ? statusOf(current) : undefined;
  resetFlip();
  setRichText($("card-front"), current.front);
  setRichText($("card-back"), current.back);
  $$(".card-badge").forEach((badge) => {
    badge.dataset.status = status ?? "";
    badge.textContent = status ? STATUS_LABELS[status] : "";
    badge.classList.toggle("hidden", !status);
  });
  $("got-btn").classList.toggle("ring-2", status === "got");
  $("learning-btn").classList.toggle("ring-2", status === "learning");
  $("prev-btn").disabled = index === 0;
  $("next-btn").disabled = index === total - 1;
}

// ---- Card animations ----
// Animations use the browser's Web Animations API (element.animate). Inline styles are
// only used while a card is being dragged, to make it follow the pointer.
const stage = $("card-stage");
const overlay = $("card-overlay");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
// Cards marked "got it" leave to the right (1), "still learning" ones to the left (-1).
const sideOf = (status) => (status === "got" ? 1 : -1);
// Where a card ends up when swiped off to the left (-1) or right (1).
const offscreen = (dir) => `translateX(${dir * 120}%) rotate(${dir * 10}deg)`;
let animationId = 0;      // bumped by every new animation so older ones know they've been replaced
let exitPending = false;  // a card is swiping out and render() hasn't run for the new state yet

function setTint(status) {
  overlay.dataset.tint = status ?? "";
  overlay.textContent = status ? STATUS_LABELS[status] : "";
}

function clearInlineMotion() {
  stage.style.transform = "";
  overlay.style.opacity = "";
}

function cancelAnimations() {
  [stage, overlay, $("done")].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
}

// Stop any animation in progress and show the card the state already points to.
function settleAnimations() {
  animationId++;
  cancelAnimations();
  clearInlineMotion();
  if (exitPending) {
    exitPending = false;
    render();
  }
}

// State (index, marks) is already updated when this is called: the old card swipes
// away (optionally tinted), then the new card is rendered and animated in.
//   exit:  -1 / 1 to swipe the old card off to the left / right
//   tint:  "got" / "learning" to color the old card as it leaves
//   from:  starting transform when continuing a drag
//   enter: { type: "fade" | "slide" | "return", dir, tint }
async function animateTo({ exit = 0, tint = null, from = null, enter = { type: "fade" } } = {}) {
  const id = ++animationId;
  cancelAnimations();
  renderBar();
  if (reduceMotion.matches) {
    clearInlineMotion();
    exitPending = false;
    return render();
  }

  if (exit && !$("study").classList.contains("hidden")) {
    exitPending = true;
    setTint(tint);
    const start = from?.transform ?? "none";
    const tintStart = from?.tintOpacity ?? 0;
    clearInlineMotion();
    const out = stage.animate(
      [{ transform: start, opacity: 1 }, { transform: offscreen(exit), opacity: 0 }],
      { duration: 300, easing: "cubic-bezier(.4,0,.8,.6)", fill: "forwards" }
    );
    if (tint) {
      const tintFrames = [{ opacity: tintStart }, { opacity: 0.92, offset: 0.4 }, { opacity: 0.92 }];
      overlay.animate(tintFrames, { duration: 300, fill: "forwards" });
    }
    try {
      await out.finished;
    } catch {
      return; // interrupted; whoever interrupted renders the new state
    }
    if (id !== animationId) return;
  }

  exitPending = false;
  clearInlineMotion();
  render();
  cancelAnimations();

  const doneVisible = !$("done").classList.contains("hidden");
  const target = doneVisible ? $("done") : stage;
  let frames;
  let duration = 260;
  if (enter.type === "slide") {
    frames = [{ transform: `translateX(${enter.dir * 35}%)`, opacity: 0 }, { transform: "none", opacity: 1 }];
  } else if (enter.type === "return") {
    frames = [{ transform: offscreen(enter.dir), opacity: 0 }, { transform: "none", opacity: 1 }];
    duration = 380;
    setTint(enter.tint);
    overlay.animate([{ opacity: 0.92 }, { opacity: 0.92, offset: 0.5 }, { opacity: 0 }], { duration: 380 });
  } else {
    frames = [{ transform: "scale(0.94)", opacity: 0 }, { transform: "none", opacity: 1 }];
  }
  target.animate(frames, { duration, easing: "cubic-bezier(.2,.8,.2,1)" });
}

// ---- Actions ----
// Browsing: move forward (1) or back (-1). Returns false if there's no card that way.
// `from` is the dragged card's position, so a swipe continues from where the finger let go.
function go(step, from = null) {
  const next = index + step;
  if (next < 0 || next >= order.length) return false;
  index = next;
  animateTo({ exit: -step, from, enter: { type: "slide", dir: step } });
  return true;
}

// Shuffle the current study order and start from the first card.
function shuffle() {
  shuffleInPlace(order);
  index = 0;
  undoStack = [];
  animateTo({ enter: { type: "fade" } });
}

// Tracking mode: mark the current card and swipe it away (left = still learning, right = got it).
function mark(status, from = null) {
  if (!tracking || index >= order.length) return false;
  const current = deck.cards[order[index]];
  undoStack.push({ index, card: current, previous: statusOf(current), status });
  setStatus(current, status);
  index++;
  animateTo({ exit: sideOf(status), tint: status, from, enter: { type: "fade" } });
  return true;
}

// Tracking mode: bring the last card back from the side it left and restore its previous mark.
function undo() {
  if (!tracking || !undoStack.length) return;
  const last = undoStack.pop();
  setStatus(last.card, last.previous);
  index = last.index;
  animateTo({ enter: { type: "return", dir: sideOf(last.status), tint: last.status } });
}

function resetDeck() {
  if (!confirm(`Reset all progress for "${deck.title}"?`)) return;
  delete progress[deck.id];
  saveProgress(PROGRESS_URL, { deck: deck.id, reset: true });
  setFilter("all");
}

// ---- Events ----
$$(".filter-btn").forEach((btn) => btn.addEventListener("click", () => setFilter(btn.dataset.filter)));
$$(".flip-btn").forEach((btn) => btn.addEventListener("click", () => setFlipped(!flipped)));
$$(".shuffle-btn").forEach((btn) => btn.addEventListener("click", shuffle));
$$(".undo-btn").forEach((btn) => btn.addEventListener("click", undo));
$("track-btn").addEventListener("click", () => setTracking(!tracking));
$("prev-btn").addEventListener("click", () => go(-1));
$("next-btn").addEventListener("click", () => go(1));
$("got-btn").addEventListener("click", () => mark("got"));
$("learning-btn").addEventListener("click", () => mark("learning"));
$("study-todo-btn").addEventListener("click", () => setFilter("todo"));
$("restart-btn").addEventListener("click", () => setFilter("all"));
$("reset-btn").addEventListener("click", resetDeck);

// The arrow keys mark cards while tracking, and move between cards while browsing.
const left = () => (tracking ? mark("learning") : go(-1));
const right = () => (tracking ? mark("got") : go(1));

// Drag the card sideways (finger or mouse). When tracking, dragging left / right tints the
// card and marks it "still learning" / "got it"; when browsing it turns to the next / previous card.
const SWIPE_THRESHOLD = 80;   // pixels the card must be dragged before letting go counts as a swipe
let drag = null;              // the drag in progress: { id, x, y, dx, active }
let suppressClick = false;    // stops the click that ends a mouse drag from also flipping the card

function swipeAction(dx, from) {
  if (tracking) return mark(dx < 0 ? "learning" : "got", from);
  return go(dx < 0 ? 1 : -1, from);
}

card.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  suppressClick = false;
  settleAnimations();
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false };
});
card.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  // Only start dragging once the pointer has clearly moved sideways, so taps and
  // vertical scrolls aren't mistaken for swipes.
  if (!drag.active) {
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
    drag.active = true;
    card.setPointerCapture(e.pointerId);
  }
  drag.dx = dx;
  stage.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
  if (tracking) {
    setTint(dx < 0 ? "learning" : "got");
    // Fades in over the first 1.5 swipe lengths of the drag.
    const strength = Math.min(Math.abs(dx) / (SWIPE_THRESHOLD * 1.5), 1);
    overlay.style.opacity = String(strength * 0.92);
  }
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { active, dx } = drag;
  drag = null;
  if (!active) return;
  suppressClick = true;
  const from = { transform: stage.style.transform, tintOpacity: Number(overlay.style.opacity) || 0 };
  if (e.type === "pointerup" && Math.abs(dx) > SWIPE_THRESHOLD && swipeAction(dx, from)) return;
  // Not far enough (or nowhere to go): spring back.
  clearInlineMotion();
  stage.animate([{ transform: from.transform }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
  overlay.animate([{ opacity: from.tintOpacity }, { opacity: 0 }], { duration: 220 });
}
card.addEventListener("pointerup", endDrag);
card.addEventListener("pointercancel", endDrag);
card.addEventListener("click", () => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  setFlipped(!flipped);
});

// Keyboard shortcuts (ignored with Ctrl / Cmd / Alt held).
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case "ArrowLeft":
      left();
      break;
    case "ArrowRight":
      right();
      break;
    case "z":
    case "Z":
    case "Backspace":
      undo();
      break;
    case "Escape":
      goHome();
      break;
    case "ArrowUp":
    case "ArrowDown":
    case " ":
    case "Enter":
      e.preventDefault();
      setFlipped(!flipped);
      break;
  }
});

$("track-btn").setAttribute("aria-checked", String(tracking));
setFilter("all");
loadProgress();
