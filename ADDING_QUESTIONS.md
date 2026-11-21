# Greetings agents! If you have been told to add a multiple choice quiz, all you need to do is the following:

## 1. How to write the questions
- Unless otherwise specified, give each question 4 options (`a` through `d`)
- Make the wrong options plausible, and vary which letter holds the correct answer
- A question can have more than one correct answer. The quiz tells the user to "Select all that apply" when it does, and they must pick exactly the correct options to get it right


## 2. Create a new json file under `questions/`
Name it something relevant

All json files should follow this schema:
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

- Options use the lowercase letters `a` through `j`, and every question needs at least two
- `correct` is a list of the correct option letters, and every letter in it must be one of the question's options
- Every `prompt` in a quiz must be unique

The file name and the prompt of each question are used to save the user's results in `questions/progress.json`, so avoid renaming quiz files or rewording existing prompts unless asked to. Don't name a quiz `progress.json`, and don't edit or delete `questions/progress.json`.

### Math (LaTeX)
Prompts and options can contain LaTeX, which is rendered with KaTeX:
- `$...$` for inline math, e.g. `"prompt": "What is $\\sqrt{16}$?"` or `"a": "$\\dfrac{1}{2}$"`
- `$$...$$` for display math, which is centered on its own line
- `\\$` for a literal dollar sign next to math or in text that might be mistaken for math. Plain prices like `$10 million` are left alone without escaping

Because the file is JSON, every backslash in LaTeX must be doubled: write `\\frac{1}{2}`, not `\frac{1}{2}`. A single backslash either breaks the file or silently changes the text (`\f`, `\n`, `\t`, `\b` and `\r` are JSON escapes, so `\frac` would turn into a form feed followed by `rac`).

Inline fractions are drawn small, as in normal LaTeX. Use `\\dfrac` for full-size ones, which is usually better for answer options. If the LaTeX has a mistake, the question shows it in red instead of the math, so check any math-heavy quiz in the browser. Only use math where it helps; don't wrap ordinary numbers or words in `$`.

If a quiz file has a mistake (bad JSON, a missing prompt, or a `correct` letter that isn't an option), the server skips it and prints a warning saying why, so check the server output if a quiz doesn't show up.

## 3. Run `app.py` using the `pyenv/` python environment
```
pyenv/bin/python app.py
```
This starts the server at http://127.0.0.1:8000/ (use `--port` to pick a different port). The quizzes can only be viewed through this server.

If the server is already running, you don't need to restart it. New and edited quizzes show up when the page is refreshed.

## 4. Using your browser skill, open the quiz in the browser to show the user
The home page (http://127.0.0.1:8000/) lists every quiz. Each quiz is at http://127.0.0.1:8000/quiz?quiz=<file name without .json>, e.g. `questions/example.json` is at http://127.0.0.1:8000/quiz?quiz=example

To add a flashcards instead, see `ADDING_CARDS.md`.
