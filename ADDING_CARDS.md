# Greetings agents! If you have been told to add a deck of flashcards, all you need to do is the following:

## 1. How to style the cards
- Unless otherwise specified, make cards in the style of term and definition instead of question and answer
- Keep the back of each card short, about 1–3 sentences. Longer text still works, but the user may have to scroll inside the card to read it


## 2. Create a new json file under `cards/`
Name it something relevant, in lowercase with underscores and no spaces (e.g. `chapter17_sectional_struggle.json`). The file name becomes part of the deck's URL.

All json files should follow this schema:
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

- `title` is the name shown on the home page. If it's left out, the file name is shown instead
- `date` is the date the deck was made (today's date), unless the user asks for a different one. It's optional
- Every card front must be unique within a deck. If two cards have the same front, the later one silently replaces the earlier one
- The file must be valid JSON: double quotes inside card text must be escaped as `\"`. To put a line break inside a card, write `\n`

The file name and the front of each card are used to save the user's learning progress in `cards/progress.json`, so avoid renaming deck files or rewording the front of existing cards unless asked to. Adding new cards to an existing deck is safe, and the user's progress on the other cards is kept. Don't name a deck `progress.json`, and don't edit or delete `cards/progress.json`.

### Math (LaTeX)
Card fronts and backs can contain LaTeX, which is rendered with KaTeX:
- `$...$` for inline math, e.g. `"Area of a circle": "$A = \\pi r^2$"`
- `$$...$$` for display math, which is centered on its own line
- `\\$` for a literal dollar sign next to math or in text that might be mistaken for math. Plain prices like `$10 million` are left alone without escaping

Because the file is JSON, every backslash in LaTeX must be doubled: write `\\frac{1}{2}`, not `\frac{1}{2}`. A single backslash either breaks the file or silently changes the text (`\f`, `\n`, `\t`, `\b` and `\r` are JSON escapes, so `\frac` would turn into a form feed followed by `rac`).

Inline fractions are drawn small, as in normal LaTeX. Use `\\dfrac` for a full-size one. If the LaTeX has a mistake, the card shows it in red instead of the math, so check any math-heavy cards in the browser. Only use math where it helps; don't wrap ordinary numbers or words in `$`.

If a deck file has a mistake (such as invalid JSON), the server skips it and prints a warning saying why, so check the server output if a deck doesn't show up.

## 3. Run `app.py` using the `pyenv/` python environment
```
pyenv/bin/python app.py
```
This starts the server at http://127.0.0.1:8000/ (use `--port` to pick a different port). The cards can only be viewed through this server.

If the server is already running, you don't need to restart it. New and edited decks show up when the page is refreshed.

## 4. Using your browser skill, open the deck in the browser to show the user the cards
The home page (http://127.0.0.1:8000/) lists every deck. Each deck is at http://127.0.0.1:8000/cards?deck=<file name without .json>, e.g. `cards/example.json` is at http://127.0.0.1:8000/cards?deck=example

To add a multiple choice quiz instead, see `ADDING_QUESTIONS.md`.
