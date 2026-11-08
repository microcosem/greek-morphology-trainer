#!/usr/bin/env python3
"""Build data.js from wordlist.csv (the single source of truth).

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
script stops and data.js is not written) or warnings (the build continues).
"""
import csv
import json
import os
import re
import sys
import unicodedata

CSV_FILE = "wordlist.csv"
OUT_FILE = "data.js"

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

    print(f"Wrote {OUT_FILE}: {len(verbs)} verbs, {len(cells)} forms, {len(warnings)} warning(s).")


if __name__ == "__main__":
    main()
