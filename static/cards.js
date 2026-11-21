// Flashcard study page. DECK is set by templates/cards.html; $, $$, fetchProgress and
// postProgress come from common.js.

// Tailwind only generates classes it can see written out in the templates and scripts,
// so every class that JavaScript adds is spelled out in full in constants like this one.
const BADGES = {
  got: { text: "Got it", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-300" },
  learning: { text: "Still learning", className: "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-300" },
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

// Cards are identified by their front text, so rewording a front loses its mark.
// Set (or clear, with a falsy status) a card's mark and save it.
function setStatus(c, status) {
  const deckProgress = (progress[deck.id] ??= {});
  if (status) deckProgress[c.front] = status;
  else delete deckProgress[c.front];
  if (!Object.keys(deckProgress).length) delete progress[deck.id];
  persist({ deck: deck.id, card: c.front, status: status || null });
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
  $$(".filter-btn").forEach((btn) => {
    const active = btn.dataset.filter === filter;
    ["bg-white", "text-slate-900", "shadow", "dark:bg-neutral-600", "dark:text-white"].forEach((cls) =>
      btn.classList.toggle(cls, active)
    );
  });
  order = deck.cards
    .map((_, n) => n)
    .filter((n) => filter === "all" || statusOf(deck.cards[n]) !== "got");
  index = 0;
  undoStack = [];
  animateTo({ enter: { type: "fade" } });
}

// ---- Segmented progress bar ----
const bar = $("progress-bar");
const SEGMENT_COLORS = {
  got: "bg-emerald-500",
  learning: "bg-amber-400",
  seen: "bg-indigo-500 dark:bg-neutral-300",
  current: "bg-slate-400 dark:bg-neutral-400",
  empty: "bg-slate-200 dark:bg-neutral-700",
};

// Browsing: segments up to the current card are filled in.
// Tracking: segments show each card's mark (green / amber), grey if unmarked.
// The current card's segment is drawn taller in both modes.
function renderBar() {
  const total = order.length;
  $("progress").textContent = `${Math.min(index + 1, total)} / ${total}`;
  // No cards left to study (every card is "got it"): show one full green bar.
  if (!total) {
    const color = deck.cards.length ? SEGMENT_COLORS.got : SEGMENT_COLORS.empty;
    bar.replaceChildren(Object.assign(document.createElement("span"), { className: `h-2 flex-1 rounded-full ${color}` }));
    return;
  }

  // Shrink the gaps on big decks so the segments still fit.
  bar.style.gap = total > 100 ? "0px" : total > 40 ? "1px" : "3px";

  // Only rebuild the segment elements when the number of cards changes.
  if (bar.children.length !== total) {
    bar.replaceChildren(...Array.from({ length: total }, () => document.createElement("span")));
  }
  const shape = total > 100 ? "" : "rounded-full";
  [...bar.children].forEach((segment, i) => {
    const status = tracking ? statusOf(deck.cards[order[i]]) : null;
    let color;
    if (tracking) color = SEGMENT_COLORS[status] ?? (i === index ? SEGMENT_COLORS.current : SEGMENT_COLORS.empty);
    else color = i <= index ? SEGMENT_COLORS.seen : SEGMENT_COLORS.empty;
    segment.className = `min-w-0 flex-1 transition-all duration-200 ${shape} ${i === index ? "h-3.5" : "h-2"} ${color}`;
  });
  bar.setAttribute("aria-valuemin", "1");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(Math.min(index + 1, total)));
}

// Which card a point on the bar corresponds to (works in the gaps between segments too).
function barIndexAt(clientX) {
  const rect = bar.getBoundingClientRect();
  const i = Math.floor(((clientX - rect.left) / rect.width) * order.length);
  return Math.max(0, Math.min(order.length - 1, i));
}

// Move to any card. Clicks animate; scrubbing (dragging along the bar) jumps instantly.
function jumpTo(target, animated) {
  if (target === index || target < 0 || target >= order.length) return;
  const dir = Math.sign(target - index);
  index = target;
  if (animated) animateTo({ exit: -dir, enter: { type: "slide", dir } });
  else {
    settleAnimations();
    render();
  }
}

// Click a segment to jump to that card, or drag along the bar to scrub through cards.
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
// Update the whole study view to match the current state. Called after every change
// (usually through animateTo, which times it to happen between the swipe out and in).
function render() {
  const counts = countStatuses();
  $("deck-counts").textContent = describeCounts(counts);
  $$(".undo-btn").forEach((btn) => (btn.disabled = undoStack.length === 0));
  renderBar();

  // "Done" means a tracked round just finished, or the "Not got yet" filter left no cards.
  const total = order.length;
  const done = index >= total;
  $("study").classList.toggle("hidden", done);
  $("done").classList.toggle("hidden", !done);

  if (done) {
    const empty = !deck.cards.length;
    const remaining = deck.cards.length - counts.got;
    $("done-title").textContent = empty ? "This deck has no cards yet." : total ? "Round complete!" : "You've got every card in this deck!";
    $("done-summary").textContent = empty ? "" : describeCounts(counts);
    $("study-todo-btn").classList.toggle("hidden", remaining === 0);
    $("restart-btn").classList.toggle("hidden", empty);
    return;
  }

  const current = deck.cards[order[index]];
  const status = tracking ? statusOf(current) : undefined;
  resetFlip();
  setRichText($("card-front"), current.front);
  setRichText($("card-back"), current.back);
  $$(".card-badge").forEach((badge) => {
    // Strip the previous badge's color classes before adding the new ones.
    badge.className = badge.className.replace(/ (bg|text|dark:bg|dark:text)-(emerald|amber)\S*/g, "");
    badge.classList.toggle("hidden", !status);
    if (status) {
      badge.textContent = BADGES[status].text;
      badge.classList.add(...BADGES[status].className.split(" "));
    }
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
const TINTS = {
  got: { text: "Got it", className: "bg-emerald-500 text-white" },
  learning: { text: "Still learning", className: "bg-amber-400 text-amber-950" },
};
// Where a card ends up when swiped off to the left (-1) or right (1).
const offscreen = (dir) => `translateX(${dir * 120}%) rotate(${dir * 10}deg)`;
let animationId = 0;      // bumped by every new animation so older ones know they've been replaced
let exitPending = false;  // a card is swiping out and render() hasn't run for the new state yet

function setTint(status) {
  overlay.classList.remove(...TINTS.got.className.split(" "), ...TINTS.learning.className.split(" "));
  overlay.textContent = status ? TINTS[status].text : "";
  if (status) overlay.classList.add(...TINTS[status].className.split(" "));
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
    if (tint) overlay.animate([{ opacity: tintStart }, { opacity: 0.92, offset: 0.4 }, { opacity: 0.92 }], { duration: 300, fill: "forwards" });
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
  if (enter.type === "slide") {
    frames = [{ transform: `translateX(${enter.dir * 35}%)`, opacity: 0 }, { transform: "none", opacity: 1 }];
  } else if (enter.type === "return") {
    frames = [{ transform: offscreen(enter.dir), opacity: 0 }, { transform: "none", opacity: 1 }];
    setTint(enter.tint);
    overlay.animate([{ opacity: 0.92 }, { opacity: 0.92, offset: 0.5 }, { opacity: 0 }], { duration: 380 });
  } else {
    frames = [{ transform: "scale(0.94)", opacity: 0 }, { transform: "none", opacity: 1 }];
  }
  target.animate(frames, { duration: enter.type === "return" ? 380 : 260, easing: "cubic-bezier(.2,.8,.2,1)" });
}

// ---- Actions ----
function goHome() {
  location.href = $("back-btn").href;
}

// Browsing: move forward (1) or back (-1). Returns false if there's no card that way.
// `from` is the dragged card's position, so a swipe continues from where the finger let go.
function go(step, from = null) {
  const next = index + step;
  if (next < 0 || next >= order.length) return false;
  index = next;
  animateTo({ exit: -step, from, enter: { type: "slide", dir: step } });
  return true;
}

// Shuffle the current study order (Fisher-Yates) and start from the first card.
function shuffle() {
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
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
  animateTo({ exit: status === "got" ? 1 : -1, tint: status, from, enter: { type: "fade" } });
  return true;
}

// Tracking mode: bring the last card back from the side it left and restore its previous mark.
function undo() {
  if (!tracking || !undoStack.length) return;
  const last = undoStack.pop();
  setStatus(last.card, last.previous);
  index = last.index;
  animateTo({ enter: { type: "return", dir: last.status === "got" ? 1 : -1, tint: last.status } });
}

function resetDeck() {
  if (!confirm(`Reset all progress for "${deck.title}"?`)) return;
  delete progress[deck.id];
  persist({ deck: deck.id, reset: true });
  setFilter("all");
}

// ---- Events ----
$$(".filter-btn").forEach((btn) =>
  btn.addEventListener("click", () => setFilter(btn.dataset.filter))
);
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
    overlay.style.opacity = String(Math.min(Math.abs(dx) / (SWIPE_THRESHOLD * 1.5), 1) * 0.92);
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
