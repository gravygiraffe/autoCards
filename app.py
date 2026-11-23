#!/usr/bin/env python3
"""Serve the autoCards flashcards and quizzes, and save study progress.

Run with:  pyenv/bin/python app.py [--host 0.0.0.0] [--port 8000]

Every JSON file in cards/ (except progress.json) is a flashcard deck, and every
JSON file in questions/ (except progress.json) is a multiple choice quiz.

Pages (rendered by Flask/Jinja from templates/):
  /                    home.html   lists every deck and quiz
  /cards?deck=<id>     cards.html  studies one deck   (script: static/cards.js)
  /quiz?quiz=<id>      quiz.html   takes one quiz     (script: static/quiz.js)

A deck or quiz's id is its file name without .json. Styles come from
static/style.css, which Tailwind generates from the templates and scripts on startup.
"""

import argparse
import json
import os
import sys
import threading
import time
from pathlib import Path

import pytailwindcss
from flask import Flask, abort, jsonify, redirect, render_template, request, url_for
from pytailwindcss.exceptions import PyTailwindCssException

# ---- File Paths ----
ROOT = Path(__file__).resolve().parent
CARDS_DIR = ROOT / "cards"
QUESTIONS_DIR = ROOT / "questions"
TEMPLATES_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"
CSS_INPUT = TEMPLATES_DIR / "input.css"
CSS_OUTPUT = STATIC_DIR / "style.css"
# Pinned so every machine builds the same style.css. pytailwindcss downloads this
# version of the standalone Tailwind binary on first run.
TAILWIND_VERSION = "v4.3.3"

# Progress lives next to the decks and quizzes, so it's skipped when loading them.
# Cards:   {"<deck id>": {"<card front>": "got" | "learning"}}
# Quizzes: {"<quiz id>": {"<question prompt>": "correct" | "incorrect"}}
CARD_PROGRESS = CARDS_DIR / "progress.json"
QUIZ_PROGRESS = QUESTIONS_DIR / "progress.json"
LAST_OPENED = ROOT / "last_opened.json"
CARD_STATUSES = {"got", "learning"}
QUIZ_STATUSES = {"correct", "incorrect"}

app = Flask(__name__, template_folder=TEMPLATES_DIR, static_folder=STATIC_DIR)

# Flask handles requests on multiple threads; this keeps two quick marks from
# both reading the old file and one overwriting the other's change.
progress_lock = threading.Lock()


# ---- Decks ----

def normalize_cards(raw):
    """Accept either {"front": "back", ...} or [{"front": ..., "back": ...}, ...]."""
    if isinstance(raw, dict):
        return [{"front": str(f), "back": str(b)} for f, b in raw.items()]
    if isinstance(raw, list):
        return [
            {"front": str(c.get("front", "")), "back": str(c.get("back", ""))}
            for c in raw
            if isinstance(c, dict)
        ]
    raise ValueError("'cards' must be an object or a list")


def load_json_files(folder, progress_file, parse):
    """Read every JSON file in a folder with `parse`, sorted by title.

    The file name is the item's id in progress.json, so it stays stable even if
    the title is changed. Broken files are skipped with a warning.
    """
    items = []
    for path in sorted(folder.glob("*.json")):
        if path == progress_file:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            items.append(
                {
                    "id": path.stem,
                    "title": data.get("title") or path.stem,
                    "date": data.get("date", ""),
                    **parse(data),
                }
            )
        except (json.JSONDecodeError, ValueError, AttributeError, TypeError) as e:
            print(f"warning: skipping {path.relative_to(ROOT)}: {e}", file=sys.stderr)
    items.sort(key=lambda d: d["title"].lower())
    return items


def load_decks():
    def parse(data):
        return {"cards": normalize_cards(data.get("cards", {}))}

    return load_json_files(CARDS_DIR, CARD_PROGRESS, parse)


# ---- Quizzes ----

OPTION_KEYS = "abcdefghij"


def normalize_question(raw):
    """Turn {"prompt", "a", "b", ..., "correct": [...]} into
    {"prompt", "options": [{"key", "text"}, ...], "correct": [keys]}."""
    if not isinstance(raw, dict):
        raise ValueError("each question must be an object")
    prompt = str(raw.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("every question needs a 'prompt'")
    options = [{"key": k, "text": str(raw[k])} for k in OPTION_KEYS if k in raw]
    if len(options) < 2:
        raise ValueError(f"question {prompt!r} needs at least two options")
    correct = raw.get("correct", [])
    if isinstance(correct, str):
        correct = [correct]
    keys = {o["key"] for o in options}
    correct = [str(c).lower() for c in correct]
    if not correct or any(c not in keys for c in correct):
        raise ValueError(f"question {prompt!r} has a missing or invalid 'correct' list")
    return {"prompt": prompt, "options": options, "correct": sorted(set(correct))}


def load_quizzes():
    def parse(data):
        questions = data.get("questions", [])
        if not isinstance(questions, list):
            raise ValueError("'questions' must be a list")
        return {"questions": [normalize_question(q) for q in questions]}

    return load_json_files(QUESTIONS_DIR, QUIZ_PROGRESS, parse)


# ---- Progress ----

def load_progress(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def save_progress(path, data):
    # Write to a temporary file and then swap it in, so the real file is never
    # left half-written if the server is stopped mid-save.
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def apply_update(data, update, group_key, item_key, statuses):
    """Apply one change sent by a page to the progress data (in place).

    For cards (group_key "deck", item_key "card"):
      {"deck": id, "card": front, "status": "got" | "learning"}  marks a card
      {"deck": id, "card": front, "status": null}                clears a card's mark
      {"deck": id, "reset": true}                                clears the whole deck
    Quizzes use "quiz" / "question" / "correct" | "incorrect" the same way.
    """
    group = update.get(group_key)
    if not isinstance(group, str):
        raise ValueError(f"'{group_key}' must be a string")

    if update.get("reset") is True:
        data.pop(group, None)
        return

    item = update.get(item_key)
    status = update.get("status")
    if not isinstance(item, str):
        raise ValueError(f"'{item_key}' must be a string")
    if status is not None and status not in statuses:
        raise ValueError(f"'status' must be one of {sorted(statuses)} or null")

    if not isinstance(data.get(group), dict):
        data[group] = {}
    if status:
        data[group][item] = status
    else:
        data[group].pop(item, None)
    # Don't leave empty groups behind in the file.
    if not data[group]:
        del data[group]


def progress_endpoints(path, group_key, item_key, statuses):
    """Return GET and POST handlers for one progress file."""

    def get():
        with progress_lock:
            return jsonify(load_progress(path))

    def post():
        # Pages send one small change per mark (rather than all of their progress)
        # so that two open tabs or devices don't overwrite each other's marks.
        update = request.get_json(silent=True)
        if not isinstance(update, dict):
            abort(400, "body must be a JSON object")
        with progress_lock:
            data = load_progress(path)
            try:
                apply_update(data, update, group_key, item_key, statuses)
            except ValueError as e:
                abort(400, str(e))
            save_progress(path, data)
        return jsonify(data)

    return get, post


# ---- Last opened ----

def mark_opened(kind, item_id):
    """Record that a deck ("cards") or quiz ("quizzes") was just opened."""
    with progress_lock:
        data = load_progress(LAST_OPENED)
        if not isinstance(data.get(kind), dict):
            data[kind] = {}
        data[kind][item_id] = time.time()
        save_progress(LAST_OPENED, data)


def sort_by_last_opened(items, opened):
    """Most recently opened first; never-opened items follow, still sorted by title."""
    def key(item):
        when = opened.get(item["id"])
        return -when if isinstance(when, (int, float)) else float("inf")

    # sort() is stable, so items with the same key keep their title order.
    return sorted(items, key=key)


# ---- Routes ----

# Decks and quizzes are read on every request, so new or edited files show up on refresh.

@app.get("/")
def home():
    with progress_lock:
        opened = load_progress(LAST_OPENED)
    card_times = opened.get("cards") if isinstance(opened.get("cards"), dict) else {}
    quiz_times = opened.get("quizzes") if isinstance(opened.get("quizzes"), dict) else {}
    return render_template(
        "home.html",
        decks=sort_by_last_opened(load_decks(), card_times),
        quizzes=sort_by_last_opened(load_quizzes(), quiz_times),
    )


def find(items, item_id):
    return next((item for item in items if item["id"] == item_id), None)


@app.get("/cards")
def cards():
    deck = find(load_decks(), request.args.get("deck", ""))
    if deck is None:
        return redirect(url_for("home"))
    mark_opened("cards", deck["id"])
    return render_template("cards.html", deck=deck)


@app.get("/quiz")
def quiz():
    found = find(load_quizzes(), request.args.get("quiz", ""))
    if found is None:
        return redirect(url_for("home"))
    mark_opened("quizzes", found["id"])
    return render_template("quiz.html", quiz=found)


card_get, card_post = progress_endpoints(CARD_PROGRESS, "deck", "card", CARD_STATUSES)
quiz_get, quiz_post = progress_endpoints(QUIZ_PROGRESS, "quiz", "question", QUIZ_STATUSES)
app.add_url_rule("/api/progress", "get_progress", card_get, methods=["GET"])
app.add_url_rule("/api/progress", "update_progress", card_post, methods=["POST"])
app.add_url_rule("/api/quiz-progress", "get_quiz_progress", quiz_get, methods=["GET"])
app.add_url_rule("/api/quiz-progress", "update_quiz_progress", quiz_post, methods=["POST"])


@app.after_request
def no_cache(response):
    # Always fetch fresh decks, styles, scripts and progress instead of a stale cached copy.
    response.headers["Cache-Control"] = "no-store"
    return response


# ---- Startup ----

def build_css():
    """Compile the Tailwind classes used by the pages into static/style.css.

    Tailwind only includes classes it finds written out in templates/*.html and
    static/*.js (see templates/input.css), so classes must appear there as complete strings.
    """
    STATIC_DIR.mkdir(exist_ok=True)
    try:
        pytailwindcss.run(
            ["--input", str(CSS_INPUT), "--output", str(CSS_OUTPUT), "--minify"],
            cwd=TEMPLATES_DIR,
            auto_install=True,
            version=TAILWIND_VERSION,
        )
    except (PyTailwindCssException, OSError) as e:
        # Usually no internet on the first run; the committed style.css still works.
        print(f"warning: couldn't get Tailwind, style.css not rebuilt: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1",
                        help="address to listen on (use 0.0.0.0 to allow other devices, e.g. your phone)")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    build_css()
    decks = load_decks()
    quizzes = load_quizzes()
    card_count = sum(len(d["cards"]) for d in decks)
    question_count = sum(len(q["questions"]) for q in quizzes)
    print(f"Loaded {len(decks)} deck(s), {card_count} card(s)")
    print(f"Loaded {len(quizzes)} quiz(zes), {question_count} question(s)")
    app.run(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
