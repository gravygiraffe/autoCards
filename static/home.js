// Home page: fills in the progress bar and stats on each deck and quiz.
// DECKS and QUIZZES are set by templates/home.html.

function fillStats(link, total, good, bad, text) {
  const n = total || 1;
  link.querySelector(".bar-good").style.width = `${(good / n) * 100}%`;
  link.querySelector(".bar-bad").style.width = `${(bad / n) * 100}%`;
  link.querySelector(".stats").textContent = text;
}

async function renderDeckStats() {
  let progress = {};
  try {
    progress = await fetchProgress("api/progress");
  } catch {
    return;
  }
  $$(".deck-link").forEach((link) => {
    const deck = DECKS[Number(link.dataset.deck)];
    const marks = progress[deck.id] ?? {};
    let got = 0;
    let learning = 0;
    for (const c of deck.cards) {
      if (marks[c.front] === "got") got++;
      else if (marks[c.front] === "learning") learning++;
    }
    fillStats(link, deck.cards.length, got, learning, `${got} got it · ${learning} still learning`);
  });
}

async function renderQuizStats() {
  let progress = {};
  try {
    progress = await fetchProgress("api/quiz-progress");
  } catch {
    return;
  }
  $$(".quiz-link").forEach((link) => {
    const quiz = QUIZZES[Number(link.dataset.quiz)];
    const results = progress[quiz.id] ?? {};
    let correct = 0;
    let incorrect = 0;
    for (const q of quiz.questions) {
      if (results[q.prompt] === "correct") correct++;
      else if (results[q.prompt] === "incorrect") incorrect++;
    }
    fillStats(link, quiz.questions.length, correct, incorrect, `${correct} correct · ${incorrect} incorrect`);
  });
}

// Collapsible Flashcards / Quizzes sections. Collapsed state is remembered per section.
function setCollapsed(btn, collapsed) {
  btn.setAttribute("aria-expanded", String(!collapsed));
  btn.querySelector(".chevron").classList.toggle("-rotate-90", collapsed);
  $(btn.getAttribute("aria-controls")).hidden = collapsed;
}

$$(".section-toggle").forEach((btn) => {
  const key = `collapsed-${btn.dataset.section}`;
  setCollapsed(btn, localStorage.getItem(key) === "1");
  btn.addEventListener("click", () => {
    const collapsed = btn.getAttribute("aria-expanded") === "true";
    setCollapsed(btn, collapsed);
    localStorage.setItem(key, collapsed ? "1" : "0");
  });
});

renderDeckStats();
renderQuizStats();
