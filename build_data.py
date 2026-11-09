#!/usr/bin/env python3
"""Build data.js and reference.html from wordlist.csv (the single source of truth).

Usage:  python3 build_data.py

wordlist.csv layout (one column per verb, labels in column A):

  Present tense / Future tense / Imperfect (past) tense / Aorist (1st) / Aorist (2nd)
      a heading row for each tense, followed by six rows:
      "1st person singular" ... "3rd person plural"
      Write "No ..." or "Not ..." (for example "No 2nd aorist") where a form does not exist.
      The first present-tense cell of each column is the verb's dictionary form (lemma).
  Translation
      the dictionary meaning, for example "I lead, force".
  English base form / English 3rd person singular / English past / English -ing form
      for example: pursue / pursues / pursued / pursuing.
      The full translations ("We were pursuing") are generated from these.
  English aorist (optional)
      only for verbs whose aorist is not the plain past, for example passive
      "was/were stopped". "was/were" is filled in to agree with the person.

Rows are matched by their labels, not their position, so rows can be reordered
and verbs (columns) can be added freely. Mistakes are reported as errors (the
script stops and nothing is written) or warnings (the build continues).

Outputs:
  data.js         the data used by the trainer (index.html)
  reference.html  the "Study page": every verb's forms in tables, with translations
"""
import csv
import html
import json
import os
import re
import sys
import unicodedata

CSV_FILE = "wordlist.csv"
OUT_FILE = "data.js"
REFERENCE_FILE = "reference.html"

# Tense heading (matched by prefix, case-insensitive) -> key used by the app.
TENSE_HEADINGS = [
    ("present", "present"),
    ("future", "future"),
    ("imperfect", "imperfect"),
    ("aorist (1st)", "aorist1"),
    ("aorist (2nd)", "aorist2"),
]

PERSON_ROW = re.compile(r"^([123])(?:st|nd|rd) person (singular|plural)$", re.I)

# Row label (lowercase) -> internal key.
ENGLISH_ROWS = {
    "english base form": "base",
    "english 3rd person singular": "third",
    "english past": "past",
    "english -ing form": "ing",
    "english aorist (optional)": "aorist",
}
REQUIRED_ENGLISH = ["base", "third", "past", "ing"]

PRONOUNS = {
    (1, "s"): "I", (2, "s"): "you (sg.)", (3, "s"): "he/she/it",
    (1, "p"): "we", (2, "p"): "you (pl.)", (3, "p"): "they",
}

errors, warnings = [], []


def report(kind, message):
    """Print a message; on GitHub Actions it shows up as an annotation."""
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::{'error' if kind == 'ERROR' else 'warning'}::{message}")
    else:
        print(f"{kind}: {message}")
    (errors if kind == "ERROR" else warnings).append(message)


def nfc(text):
    """Store Greek in one consistent Unicode form."""
    return unicodedata.normalize("NFC", text.strip())


def is_placeholder(cell):
    """True for cells like "No 2nd aorist" or "Not included"."""
    return re.match(r"(?i)^(no|not)\b", cell) is not None


def capitalize(text):
    return text[0].upper() + text[1:] if text else text


def english(eng, tense, person, number):
    """Return (main translation, [alternatives]) for one form."""
    pronoun = PRONOUNS[(person, number)]
    base, third, past, ing = eng["base"], eng["third"], eng["past"], eng["ing"]
    be_present = {(1, "s"): "am", (3, "s"): "is"}.get((person, number), "are")
    was_were = "was" if number == "s" and person != 2 else "were"
    is_be = base.lower() == "be"   # "be" is irregular, handled separately
    alternatives = []

    if tense == "present":
        if is_be:
            main = f"{pronoun} {be_present}"
        else:
            main = f"{pronoun} {third if (person, number) == (3, 's') else base}"
            alternatives.append(f"{pronoun} {be_present} {ing}")
    elif tense == "future":
        main = f"{pronoun} will {base}"
        if person == 1:
            alternatives.append(f"{pronoun} shall {base}")
    elif tense == "imperfect":
        if is_be:
            main = f"{pronoun} {was_were}"
            alternatives.append(f"{pronoun} used to be")
        else:
            main = f"{pronoun} {was_were} {ing}"
            alternatives += [f"{pronoun} used to {base}", f"{pronoun} kept {ing}"]
    else:  # aorist1 / aorist2: simple past, unless the CSV gives an override
        if eng.get("aorist"):
            main = f"{pronoun} {eng['aorist'].replace('was/were', was_were)}"
        else:
            main = f"{pronoun} {past}"

    return capitalize(main), [capitalize(a) for a in alternatives]


# ---------------------------------------------------------------------------
# Study page (reference.html)
# ---------------------------------------------------------------------------

TENSE_TITLES = {
    "present": "Present", "future": "Future", "imperfect": "Imperfect",
    "aorist1": "1st aorist", "aorist2": "2nd aorist",
}
ROW_ORDER = [(1, "s"), (2, "s"), (3, "s"), (1, "p"), (2, "p"), (3, "p")]
ROW_TITLES = {
    (1, "s"): "1st sg.", (2, "s"): "2nd sg.", (3, "s"): "3rd sg.",
    (1, "p"): "1st pl.", (2, "p"): "2nd pl.", (3, "p"): "3rd pl.",
}

PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Greek Verb Study Page</title>
  <!-- GENERATED by build_data.py from wordlist.csv. Do not edit by hand. -->
  <link href="https://fonts.googleapis.com/css2?family=Gentium+Plus:ital,wght@0,400;0,700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="wide">
    <nav class="site-nav"><a href="index.html">&larr; Back to the trainer</a></nav>
    <h1>Greek Verb Study Page</h1>

    <div class="toolbar">
      <input type="search" id="filter" placeholder="Filter by Greek form or English meaning"
             autocomplete="off" autocapitalize="off" spellcheck="false">
      <label><input type="checkbox" id="show-english" checked> Show translations</label>
    </div>

    <p class="jump">__JUMP_LINKS__</p>

    __SECTIONS__

    <p class="note">__COUNT__ verbs, generated from wordlist.csv.</p>
  </main>

  <script>
    var filterBox = document.getElementById("filter");
    var englishToggle = document.getElementById("show-english");

    // Hide verbs that do not match what was typed.
    filterBox.addEventListener("input", function () {
      var query = filterBox.value.trim().toLowerCase();
      document.querySelectorAll(".verb").forEach(function (section) {
        section.hidden = query !== "" && section.dataset.search.indexOf(query) === -1;
      });
    });

    // Show or hide the small English translation under each Greek form.
    englishToggle.addEventListener("change", function () {
      document.body.classList.toggle("hide-english", !englishToggle.checked);
    });
  </script>
</body>
</html>
"""


def verb_section(index, verb, eng, verb_cells):
    """HTML for one verb: heading, English forms, and a person-by-tense table."""
    esc = html.escape
    by_slot = {(c["tense"], c["person"], c["number"]): c for c in verb_cells}
    tenses = [t for t in TENSE_TITLES if any(k[0] == t for k in by_slot)]

    head = "".join(f"<th>{TENSE_TITLES[t]}</th>" for t in tenses)
    body = []
    for person, number in ROW_ORDER:
        tds = []
        for t in tenses:
            c = by_slot.get((t, person, number))
            if c:
                tds.append(
                    f'<td><span class="greek-inline">{esc(c["form"])}</span>'
                    f'<span class="gloss">{esc(c["translation"])}</span></td>')
            else:
                tds.append('<td class="none">&ndash;</td>')
        body.append(f"<tr><th>{ROW_TITLES[(person, number)]}</th>{''.join(tds)}</tr>")

    # Everything searchable on this verb, lowercased, for the filter box.
    search_text = " ".join(
        [verb["lemma"], verb["gloss"], eng["base"]]
        + [c["form"] for c in verb_cells] + [c["translation"] for c in verb_cells]
    ).lower()

    english_forms = ", ".join(esc(eng[k]) for k in ("base", "third", "past", "ing"))
    return (
        f'<section class="verb" id="v-{esc(verb["lemma"], quote=True)}" '
        f'data-search="{esc(search_text, quote=True)}">\n'
        f'  <h2><span class="greek-inline">{esc(verb["lemma"])}</span> '
        f'<span class="verb-gloss">{esc(verb["gloss"])}</span></h2>\n'
        f'  <p class="verb-english">English forms: {english_forms}</p>\n'
        f'  <div class="table-wrap"><table>\n'
        f'    <thead><tr><th></th>{head}</tr></thead>\n'
        f'    <tbody>\n      ' + "\n      ".join(body) + "\n    </tbody>\n"
        f'  </table></div>\n</section>'
    )


def write_reference_page(verbs, cells, verb_english):
    """Write reference.html: one table per verb, built from the same data as data.js."""
    esc = html.escape
    sections, links = [], []
    for index, verb in enumerate(verbs):
        verb_cells = [c for c in cells if c["verb"] == index]
        sections.append(verb_section(index, verb, verb_english[index], verb_cells))
        links.append(f'<a href="#v-{esc(verb["lemma"], quote=True)}" class="greek-inline">{esc(verb["lemma"])}</a>')

    page = (PAGE_TEMPLATE
            .replace("__JUMP_LINKS__", " ".join(links))
            .replace("__SECTIONS__", "\n\n    ".join(sections))
            .replace("__COUNT__", str(len(verbs))))
    with open(REFERENCE_FILE, "w", encoding="utf-8") as out:
        out.write(page)


def read_layout(rows):
    """Find each labelled row. Returns (forms, translation_row, english_rows)."""
    forms, english_rows, translation_row = {}, {}, None
    tense = None
    for number, row in enumerate(rows, start=1):
        label = row[0].strip() if row else ""
        lowered = label.lower()
        if not label:
            continue
        heading = next((key for prefix, key in TENSE_HEADINGS if lowered.startswith(prefix)), None)
        person = PERSON_ROW.match(label)
        if heading:
            tense = heading
        elif person:
            if tense is None:
                report("ERROR", f"Row {number} ('{label}') appears before any tense heading.")
                continue
            key = (tense, int(person.group(1)), person.group(2).lower()[0])
            if key in forms:
                report("ERROR", f"Row {number}: '{label}' appears twice under the same tense.")
            forms[key] = row
        elif lowered == "translation":
            translation_row = row
        elif lowered in ENGLISH_ROWS:
            english_rows[ENGLISH_ROWS[lowered]] = row
        else:
            report("WARNING", f"Row {number}: unrecognised label '{label}' was ignored.")
    return forms, translation_row, english_rows


def cell(row, column):
    return row[column].strip() if row is not None and column < len(row) else ""


def main():
    if not os.path.exists(CSV_FILE):
        sys.exit(f"{CSV_FILE} not found. Run this script from the folder that contains it.")
    with open(CSV_FILE, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))

    forms, translation_row, english_rows = read_layout(rows)
    first_person_present = forms.get(("present", 1, "s"))
    if first_person_present is None:
        report("ERROR", "No 'Present tense' block with a '1st person singular' row was found.")
    if translation_row is None:
        report("WARNING", "No 'Translation' row found; dictionary meanings will be guessed.")
    for key in REQUIRED_ENGLISH:
        if key not in english_rows:
            report("ERROR", f"Missing row for English '{key}' form (see the header of build_data.py).")
    if errors:
        sys.exit(f"\nBuild stopped: {len(errors)} error(s). {OUT_FILE} was not written.")

    width = max(len(r) for r in rows)
    verbs, cells, seen = [], [], {}
    verb_english = []   # English forms for each verb, in the same order as verbs

    for column in range(1, width):
        lemma = nfc(cell(first_person_present, column))
        column_has_data = any(cell(r, column) for r in rows[1:] if r)
        if not lemma:
            if column_has_data:
                report("ERROR", f"Column {column + 1} has data but no present-tense 1st person singular (lemma).")
            continue
        if lemma in seen:
            report("ERROR", f"Verb {lemma} appears in columns {seen[lemma] + 1} and {column + 1}.")
            continue
        seen[lemma] = column

        eng = {key: cell(english_rows.get(key), column) for key in ENGLISH_ROWS.values()}
        missing = [k for k in REQUIRED_ENGLISH if not eng[k]]
        if missing:
            report("ERROR", f"{lemma}: missing English form(s): {', '.join(missing)}.")
            continue

        gloss = cell(translation_row, column) or f"I {eng['base']}"
        if not cell(translation_row, column):
            report("WARNING", f"{lemma}: no Translation; using '{gloss}'.")

        verb_index = len(verbs)
        verbs.append({"lemma": lemma, "gloss": nfc(gloss)})
        verb_english.append(eng)
        before = len(cells)

        for (tense, person, number), row in forms.items():
            form = cell(row, column)
            if not form or is_placeholder(form):
                continue
            if re.search(r"[A-Za-z]", form):
                report("WARNING", f"{lemma} ({tense}, person {person}{number}): '{form}' contains Latin letters.")
            main_text, alternatives = english(eng, tense, person, number)
            cells.append({
                "verb": verb_index, "tense": tense, "person": person, "number": number,
                "form": nfc(form), "translation": main_text, "alternatives": alternatives,
            })
        if len(cells) == before:
            report("WARNING", f"{lemma}: no usable forms found.")

    if errors:
        sys.exit(f"\nBuild stopped: {len(errors)} error(s). {OUT_FILE} was not written.")

    # Keep the same order as before: verb by verb, then tense, person, number.
    tense_order = {key: i for i, (_, key) in enumerate(TENSE_HEADINGS)}
    cells.sort(key=lambda c: (c["verb"], tense_order[c["tense"]], c["number"] != "s", c["person"]))

    dump = lambda obj: json.dumps(obj, ensure_ascii=False)
    with open(OUT_FILE, "w", encoding="utf-8") as out:
        out.write(f"// GENERATED by build_data.py from {CSV_FILE}. Do not edit by hand.\n")
        out.write("const DATA = {\n  verbs: [\n")
        out.write(",\n".join("    " + dump(v) for v in verbs))
        out.write("\n  ],\n  cells: [\n")
        out.write(",\n".join("    " + dump(c) for c in cells))
        out.write("\n  ]\n};\n")

    write_reference_page(verbs, cells, verb_english)
    print(f"Wrote {OUT_FILE}: {len(verbs)} verbs, {len(cells)} forms, {len(warnings)} warning(s).")
    print(f"Wrote {REFERENCE_FILE}")


if __name__ == "__main__":
    main()
