# Greek Verb Morphology Trainer

A flashcard-style study page for Greek verb forms. Type your answers; missed cards come back more often.

<<<<<<< HEAD
>[!TIP]
> The live site is hosted [on this GitHub Pages site](https://microcosem.github.io/greek-morphology-trainer/).

## Scope and assumptions
=======
## Where the data comes from
>>>>>>> 3288f73 (feat: Add GitHub workflow for integrating wordlist.csv, GH Pages build)

`wordlist.csv` is the single source of truth. Edit it, commit, and the site updates itself.

- One **column per verb**; labels are in column A.
- Each tense has a heading row followed by six person/number rows. Use `No ...` or `Not ...` for forms that don't exist.
- The **Translation** row holds the dictionary meaning.
- The **English** rows (base, 3rd person singular, past, -ing) are used to generate full translations such as "We were pursuing". `English aorist (optional)` is only for aorists that are not a plain past, such as `was/were stopped`.
- Rows are found by their labels, so you can reorder rows or add verbs (columns) freely.

<<<<<<< HEAD
- [`index.html`](./greek-morphology-source.html) - Source code of the study (index.html) webpage. Build with help from Claude.
- [`greek-morphology-source.csv`](./greek-verb-wordlist.csv) - Contains the list of verbs and all of their related morphologies.
=======
## How it publishes

On every push to `main`, the GitHub Action in `.github/workflows/deploy.yml` runs `build_data.py`, which checks the CSV and generates `data.js`, then deploys to GitHub Pages. If the CSV has an error, the build fails and the live site is left as it was. `data.js` is not committed.

One-time setup: **Settings -> Pages -> Source: GitHub Actions**.

## Running locally

```
python3 build_data.py          # creates data.js and reports problems
python3 -m http.server         # then open http://localhost:8000
```

## Files

| File | Purpose |
|------|---------|
| `wordlist.csv` | The data (edit this) |
| `build_data.py` | Validates the CSV and generates `data.js` |
| `index.html`, `styles.css`, `app.js` | The site |
| `.github/workflows/deploy.yml` | Automatic build and deploy |
>>>>>>> 3288f73 (feat: Add GitHub workflow for integrating wordlist.csv, GH Pages build)
