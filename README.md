# Greek Morphology Trainer 🏛️

This Greek morphology trainer was created for an Elementary Greek module at Trinity College Dublin. It was created for personal study for those at the beginners level studying ancient Greek.

<<<<<<< HEAD
<<<<<<< HEAD
>[!TIP]
> The live site is hosted [on this GitHub Pages site](https://microcosem.github.io/greek-morphology-trainer/).

## Scope and assumptions
=======
## Where the data comes from
>>>>>>> 3288f73 (feat: Add GitHub workflow for integrating wordlist.csv, GH Pages build)
=======
## Scope and assumptions
>>>>>>> 1d23ecc (fix: Restore README.md)

- The project currently includes over 50 **verbs** (no nouns or other vocab).
- This version specifically focuses on present, future, imperfect, 1st aorist, and 2nd aorist (including some "root" aorist words).

## About the files

<<<<<<< HEAD
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
=======
- [`greek-morphology-source`](./greek-verb-wordlist.csv) - Contains the list of verbs and all of their related morphologies.
- [`greek-morphology-source.html`](./greek-morphology-source.html) - Source code of the study webpage. Build with help from Claude.
>>>>>>> 1d23ecc (fix: Restore README.md)
