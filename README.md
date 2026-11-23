# autoCards
Yet another flashcard app, but as a friend said, "Why not use Quizlet? Oh wait, they want all your money."

## Features
- Create both flashcards and multiple choice quizzes
- Every JSON file in `cards/` becomes a flashcard deck and every JSON file in `questions/` becomes a quiz. Files are reread on every page load, so new or edited decks and quizzes show up when you refresh, with no server restart needed
- LaTeX support using KaTeX (bundled, so it works offline)
- Progress is saved to `cards/progress.json` and `questions/progress.json`
  - Flashcards: turn on "Track learning" to sort cards into "Got it" and "Still learning" by swiping, then study only the cards you don't know yet
  - Quizzes: each question's last result (correct or incorrect) is saved, and you can retry only the ones you got wrong
- The home page lists the most recently opened decks and quizzes first (saved to `last_opened.json`); ones you haven't opened yet follow in alphabetical order
- Shuffle, dark mode, keyboard shortcuts, and swipe gestures on touch screens
- Instructions for AI agents in `ADDING_CARDS.md` and `ADDING_QUESTIONS.md`, so you can open an agent in this project and ask it to make flashcards or quizzes

## Getting started

#### 1. Create a Python virtual environment and install the dependencies
```
python -m venv pyenv
source pyenv/bin/activate        # on Windows: pyenv\Scripts\activate
pip install -r requirements.txt
```

#### 2. Run the webserver
```
python app.py
```
The first run downloads the Tailwind CSS binary, so it needs internet access. If the download fails, the app still runs using the included `style.css`.

#### 3. Go to http://127.0.0.1:8000 in your browser

#### 4. Create JSON files for flashcards or quizzes, by hand or with an agent, and they'll show up in the app

### `app.py` Options
- `--port 5000` uses a different port (the default is 8000)
- `--host 0.0.0.0` lets other devices on your network, like your phone, open the app at `http://<your computer's IP>:8000`

## JSON schema
The file name (without `.json`) is the deck or quiz's id. It's used in the URL and to save progress, so renaming a file resets its progress. Also, don't name a file `progress.json`.

Files with mistakes, such as invalid JSON, are skipped and the server prints a warning explaining why.

### Flashcards (`cards/`)
```
{
    "title": "Example Cards",
    "date": "MM/DD/YYYY",
    "cards": {
        "front": "back",
        "front": "back"
    }
}
```
- `title` and `date` are optional. Without a title, the file name is shown
- Every card front must be unique within a deck, because progress is saved by the front of the card. If two cards have the same front, the later one replaces the earlier one

### Quizzes (`questions/`)
```
{
    "title": "Example Quiz",
    "date": "MM/DD/YYYY",
    "questions": [
        {
            "prompt": "Question text",
            "a": "option",
            "b": "option",
            "c": "option",
            "d": "option",
            "correct": ["b"]
        },
        {
            "prompt": "Question with more than one answer",
            "a": "option",
            "b": "option",
            "c": "option",
            "d": "option",
            "correct": ["a", "c"]
        }
    ]
}
```
- Each question needs at least two options, using the letters `a` through `j`
- `correct` lists the letters of the correct options. With more than one, the quiz says "Select all that apply" and you have to pick exactly the correct ones
- Every prompt must be unique within a quiz, because progress is saved by the prompt

### LaTeX
Use `$...$` for inline math and `$$...$$` for display math. Because the files are JSON, every backslash has to be doubled (eg. `"$\\frac{1}{2}$"` not `"$\frac{1}{2}$"`).

## Keyboard shortcuts
**Flashcards:** Space, Enter, or ↑/↓ flips the card, ←/→ goes to the previous/next card (or marks it "Still learning"/"Got it" while tracking), Z or Backspace undoes a mark, and Esc goes back home.

**Quizzes:** `a`–`j` or `1`–`9` picks an answer, Enter or Space checks it and then moves to the next question, ←/→ goes to the previous/next question, and Esc goes back home.
