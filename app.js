/* ==========================================================================
   Greek Verb Morphology Trainer: app logic
   Depends on data.js, which defines the global DATA object:
     DATA.verbs  = [{ lemma, gloss }, ...]
     DATA.cells  = [{ verb, tense, person, number, form,
                      translation, alternatives }, ...]
   One "cell" is one verb form, for example ἐδιώκομεν.
   `cell.verb` is an index into DATA.verbs.

   Sections: 1. Configuration  2. State  3. Saved progress  4. Text helpers
             5. Choosing a card  6. Grading  7. Screen updates  8. Events
   ========================================================================== */
"use strict";


/* ---------- 1. Configuration ---------- */

const STORAGE_KEY = "gvm2";   // localStorage key for saved progress

const TENSE_LABELS = {
  present:   "Present",
  future:    "Future",
  imperfect: "Imperfect",
  aorist1:   "1st aorist",
  aorist2:   "2nd aorist",
};

// The keys (tense, marker, pn, trans, full) are also used in saved progress,
// so renaming them would reset everyone's saved stats.
const QUESTION_LABELS = {
  tense:  "Tense",
  marker: "Imperfect marker",
  pn:     "Person & number",
  trans:  "Translation",
  full:   "Full translation",
};

const QUESTION_PROMPTS = {
  tense:  "What is the tense of this word?",
  marker: "What indicates that this word is imperfect?",
  pn:     "In this word, what is the person and number?",
  trans:  "What is the English translation of this word? Include the pronoun for the person.",
  full:   "Translate this form into English, including tense and person.",
};

// Secondary endings shown in the imperfect-marker feedback.
// Keys are person + number, e.g. "3p" = 3rd person plural.
const IMPERFECT_ENDINGS = {
  "1s": "-ον", "2s": "-ες", "3s": "-ε(ν)",
  "1p": "-ομεν", "2p": "-ετε", "3p": "-ον",
};

// English pronouns accepted for each person + number.
const ACCEPTED_PRONOUNS = {
  "1s": ["i"],
  "2s": ["you"],
  "3s": ["he/she/it", "he/she", "he", "she", "it"],
  "1p": ["we"],
  "2p": ["you"],
  "3p": ["they"],
};

// Spaced-repetition weights: a card's weight is how likely it is to be picked.
const START_WEIGHT = 1;
const MISS_WEIGHT_INCREASE = 2;
const MAX_WEIGHT = 8;
const CORRECT_WEIGHT_FACTOR = 0.5;      // weight is halved after a correct answer
const OVERRIDE_WEIGHT_FACTOR = 0.25;    // used by "Mark as correct"
const MIN_WEIGHT = 0.25;


/* ---------- 2. State ---------- */

const enabledQuestions = new Set(Object.keys(QUESTION_LABELS));
const enabledTenses = new Set(Object.keys(TENSE_LABELS));

let weights = {};                                // "cellIndex|questionType" -> weight
let score = { ok: 0, n: 0, streak: 0 };          // ok = correct, n = attempted
let currentCard = null;                          // { questionType, cellIndex, cell }
let hasAnswered = false;                         // true after Check, until Next

const el = {};                                   // page elements, filled in by init()


/* ---------- 3. Saved progress ---------- */

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) {
      weights = saved.stats || {};
      score = saved.score || score;
    }
  } catch (error) {
    // Storage can be unavailable (private browsing, for example). Start fresh.
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ stats: weights, score }));
  } catch (error) {
    // Ignore: the app still works without saving.
  }
}


/* ---------- 4. Text helpers ---------- */

// Lowercase, drop (parenthetical notes), and keep only a-z, "/" and spaces.
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z\/\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Number of single-character edits needed to turn string a into string b.
function editDistance(a, b) {
  const table = [];
  for (let i = 0; i <= a.length; i++) table[i] = [i];
  for (let j = 1; j <= b.length; j++) table[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      table[i][j] = Math.min(
        table[i - 1][j] + 1,                       // deletion
        table[i][j - 1] + 1,                       // insertion
        table[i - 1][j - 1] + substitutionCost     // substitution
      );
    }
  }
  return table[a.length][b.length];
}

// "I lead, force" -> ["lead", "force"]. Also expands "walk/go towards"
// into ["walk towards", "go towards"].
function glossAlternatives(gloss) {
  const results = [];
  gloss.split(",").forEach(part => {
    const cleaned = normalize(part).replace(/^(i|to|he|she|it|we|you|they)\s+/, "");
    if (!cleaned) return;

    const slash = cleaned.match(/^(\w+)\/(\w+)(.*)$/);
    if (slash) {
      results.push((slash[1] + slash[3]).trim(), (slash[2] + slash[3]).trim());
    } else {
      results.push(cleaned);
    }
  });
  return results;
}

function describePersonNumber(person, number) {
  const ordinal = ["1st", "2nd", "3rd"][person - 1];
  return `${ordinal} person ${number === "s" ? "singular" : "plural"}`;
}

function escapeHtml(text) {
  const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
  return text.replace(/[&<>]/g, char => replacements[char]);
}

// Greek letters can be stored in two Unicode forms; normalising makes
// comparisons like lemma === "εἰμί" reliable.
function isLemma(verb, lemma) {
  return verb.lemma.normalize("NFC") === lemma.normalize("NFC");
}


/* ---------- 5. Choosing a card ---------- */

// The imperfect-marker question needs a regular augmented imperfect.
// εἰμί is irregular (ἦν, ἦσαν...), so it is skipped.
function canAskMarkerQuestion(cell) {
  const verb = DATA.verbs[cell.verb];
  return cell.tense === "imperfect" && !isLemma(verb, "εἰμί");
}

// Indexes of all cells that fit the current tense filter and question type.
function eligibleCellIndexes(questionType) {
  const indexes = [];
  DATA.cells.forEach((cell, index) => {
    if (!enabledTenses.has(cell.tense)) return;
    if (questionType === "marker" && !canAskMarkerQuestion(cell)) return;
    indexes.push(index);
  });
  return indexes;
}

function weightOf(cellIndex, questionType) {
  const saved = weights[cellIndex + "|" + questionType];
  return saved === undefined ? START_WEIGHT : saved;
}

// Random pick where higher-weight (recently missed) cards are more likely.
function pickWeighted(indexes, questionType) {
  const cardWeights = indexes.map(index => weightOf(index, questionType));
  const total = cardWeights.reduce((sum, w) => sum + w, 0);

  let remaining = Math.random() * total;
  for (let i = 0; i < indexes.length; i++) {
    remaining -= cardWeights[i];
    if (remaining <= 0) return indexes[i];
  }
  return indexes[indexes.length - 1];
}

function showNextCard() {
  const askable = [...enabledQuestions]
    .filter(type => eligibleCellIndexes(type).length > 0);

  if (askable.length === 0) {
    el.question.textContent = "No cards match these filters. Turn on more tenses or question types.";
    el.word.textContent = "";
    return;
  }

  const questionType = askable[Math.floor(Math.random() * askable.length)];
  const cellIndex = pickWeighted(eligibleCellIndexes(questionType), questionType);
  currentCard = { questionType, cellIndex, cell: DATA.cells[cellIndex] };
  hasAnswered = false;

  el.question.textContent = QUESTION_PROMPTS[questionType];
  el.word.textContent = currentCard.cell.form;
  el.answer.value = "";
  el.answer.disabled = false;
  el.result.innerHTML = "";

  el.checkBtn.classList.remove("hidden");
  el.nextBtn.classList.add("hidden");
  el.overrideBtn.classList.add("hidden");

  el.answer.focus();
  updateScoreDisplay();
}


/* ---------- 6. Grading ----------
   Each grader takes (answer, cell, verb) and returns:
     ok      true if the answer is accepted
     correct the answer shown to the learner
     note    an optional explanation shown under it
   `answer` is already trimmed and lowercased. */

function gradeTense(answer, cell, verb) {
  const says2nd = /2nd|second|strong|\b2\b/.test(answer);
  const says1st = /1st|first|weak|sigmatic|\b1\b/.test(answer);

  let guess = null;
  if (/present/.test(answer)) guess = "present";
  else if (/future/.test(answer)) guess = "future";
  else if (/imperf/.test(answer)) guess = "imperfect";
  else if (/aorist/.test(answer)) guess = says2nd ? "aorist2" : says1st ? "aorist1" : "aorist";

  // A plain "aorist" is accepted for either kind, with a reminder.
  const isBareAorist = guess === "aorist" && cell.tense.startsWith("aorist");
  const ok = guess === cell.tense || isBareAorist;

  const reminder = isBareAorist ? "Correct. Next time, also say whether it is 1st or 2nd aorist." : "";
  const glossNote = verb.gloss ? ` (“${verb.gloss}”)` : "";
  return {
    ok,
    correct: TENSE_LABELS[cell.tense],
    note: reminder || `${describePersonNumber(cell.person, cell.number)} of ${verb.lemma}${glossNote}`,
  };
}

function gradePersonNumber(answer, cell, verb) {
  let person = 0;
  if (/first|1/.test(answer)) person = 1;
  else if (/second|2/.test(answer)) person = 2;
  else if (/third|3/.test(answer)) person = 3;

  let number = "";
  if (/pl/.test(answer)) number = "p";
  else if (/sg|sing|\d\s*s\b/.test(answer)) number = "s";

  return {
    ok: person === cell.person && number === cell.number,
    correct: describePersonNumber(cell.person, cell.number),
    note: `Tense: ${TENSE_LABELS[cell.tense]} of ${verb.lemma}`,
  };
}

function gradeImperfectMarker(answer, cell) {
  const mentionsAugment = /augment|prefix|epsilon|ε|lengthen|past marker/.test(answer);
  const mentionsEnding = /ending|secondary|ον|-?ες|ομεν|ετε/.test(answer);

  let note = "";
  if (!mentionsAugment && mentionsEnding) {
    note = "The endings alone are not enough: the key marker is the augment.";
  }
  return {
    ok: mentionsAugment,
    correct: "The augment (a past-tense prefix ε- or a lengthened initial vowel), plus secondary endings. Ending here: "
      + IMPERFECT_ENDINGS[cell.person + cell.number],
    note,
  };
}

// Question "trans": the English meaning WITH the right pronoun. Tense is not checked.
function gradeTranslation(answer, cell, verb) {
  const pronounPrefix = /^(i|you|he\/she\/it|he\/she|he|she|it|we|they)\s+/;
  const typed = normalize(answer);
  const pronounMatch = typed.match(pronounPrefix);
  const typedPronoun = pronounMatch ? pronounMatch[1] : "";
  const typedVerb = pronounMatch ? typed.slice(pronounMatch[0].length) : typed;

  // Every acceptable "verb part" for this Greek verb, in any tense:
  // the dictionary meanings plus the tail of each translation without its pronoun.
  const acceptableVerbParts = new Set(glossAlternatives(verb.gloss || ""));
  DATA.cells.forEach(other => {
    if (other.verb !== cell.verb) return;
    [other.translation, ...other.alternatives].forEach(text => {
      acceptableVerbParts.add(normalize(text).replace(pronounPrefix, ""));
    });
  });

  const verbIsRight = typedVerb !== "" && [...acceptableVerbParts].some(part =>
    typedVerb === part || (part.length >= 6 && editDistance(typedVerb, part) <= 1));
  const pronounIsRight = ACCEPTED_PRONOUNS[cell.person + cell.number].includes(typedPronoun);

  let note = "";
  if (verbIsRight && !pronounIsRight) {
    note = `Right meaning, but the person is off (or missing): this form is ${describePersonNumber(cell.person, cell.number)}. `;
  }
  const glossNote = verb.gloss ? ` (“${verb.gloss}”)` : "";
  note += `Lemma: ${verb.lemma}${glossNote}. Tense is not checked on this question.`;

  return { ok: verbIsRight && pronounIsRight, correct: cell.translation, note };
}

// Question "full": the complete translation, including tense and person.
function gradeFullTranslation(answer, cell, verb) {
  const acceptable = new Set();
  [cell.translation, ...cell.alternatives].forEach(text => {
    const cleaned = normalize(text);
    acceptable.add(cleaned);
    // "he/she/it" also accepts plain "he", "she" or "it".
    if (cleaned.startsWith("he/she/it")) {
      ["he", "she", "it"].forEach(pronoun => acceptable.add(cleaned.replace("he/she/it", pronoun)));
    }
  });

  const typed = normalize(answer);
  // Small typos are forgiven only on longer answers, so "I hear" and
  // "I heard" are never confused.
  const ok = [...acceptable].some(candidate =>
    typed === candidate || (candidate.length >= 14 && editDistance(typed, candidate) <= 1));

  const alsoAccepted = cell.alternatives.length ? ` (also: ${cell.alternatives.join("; ")})` : "";
  return {
    ok,
    correct: cell.translation + alsoAccepted,
    note: `${TENSE_LABELS[cell.tense]}, ${describePersonNumber(cell.person, cell.number)} of ${verb.lemma}`,
  };
}

const GRADERS = {
  tense: gradeTense,
  pn: gradePersonNumber,
  marker: gradeImperfectMarker,
  trans: gradeTranslation,
  full: gradeFullTranslation,
};

function gradeCurrentAnswer() {
  const answer = el.answer.value.trim().toLowerCase();
  const { cell, questionType } = currentCard;
  return GRADERS[questionType](answer, cell, DATA.verbs[cell.verb]);
}


/* ---------- 7. Screen updates ---------- */

function updateScoreDisplay() {
  el.score.textContent = `${score.ok} / ${score.n} correct`;
  el.streak.textContent = score.streak > 1 ? `Streak: ${score.streak}` : "";
}

// Record a result and adjust how often this card will come back.
function recordResult(isCorrect) {
  const key = currentCard.cellIndex + "|" + currentCard.questionType;
  const weight = weightOf(currentCard.cellIndex, currentCard.questionType);

  score.n++;
  if (isCorrect) {
    score.ok++;
    score.streak++;
    weights[key] = Math.max(MIN_WEIGHT, weight * CORRECT_WEIGHT_FACTOR);
  } else {
    score.streak = 0;
    weights[key] = Math.min(MAX_WEIGHT, weight + MISS_WEIGHT_INCREASE);
  }
  saveProgress();
  updateScoreDisplay();
}

function showFeedback(result) {
  const cssClass = result.ok ? "correct" : "incorrect";
  const title = result.ok ? "Correct" : "Not quite";
  const noteHtml = result.note ? `<div class="note">${escapeHtml(result.note)}</div>` : "";

  el.result.innerHTML =
    `<div class="feedback ${cssClass}">` +
      `<b class="feedback-title">${title}</b>` +
      `Answer: <span class="greek-inline">${escapeHtml(result.correct)}</span>` +
      noteHtml +
    `</div>`;
}

function checkAnswer() {
  if (hasAnswered) return;
  if (!el.answer.value.trim()) return;
  hasAnswered = true;

  const result = gradeCurrentAnswer();
  recordResult(result.ok);
  showFeedback(result);

  el.answer.disabled = true;
  el.checkBtn.classList.add("hidden");
  el.nextBtn.classList.remove("hidden");
  if (!result.ok) el.overrideBtn.classList.remove("hidden");
  el.nextBtn.focus();
}

// "Mark as correct": use when the checker rejected a valid answer.
function overrideAsCorrect() {
  const key = currentCard.cellIndex + "|" + currentCard.questionType;
  const weight = weightOf(currentCard.cellIndex, currentCard.questionType);

  score.ok++;
  score.streak++;
  weights[key] = Math.max(MIN_WEIGHT, weight * OVERRIDE_WEIGHT_FACTOR);
  saveProgress();
  updateScoreDisplay();

  el.overrideBtn.classList.add("hidden");
  const box = el.result.querySelector(".feedback");
  box.className = "feedback correct";
  box.querySelector(".feedback-title").textContent = "Marked correct";
}

// Build one toggle button per option. At least one must stay switched on.
function buildChips(container, labels, enabledSet) {
  container.innerHTML = "";
  for (const key in labels) {
    const chip = document.createElement("button");
    chip.className = "chip on";
    chip.textContent = labels[key];

    chip.addEventListener("click", () => {
      if (enabledSet.has(key)) {
        if (enabledSet.size > 1) {
          enabledSet.delete(key);
          chip.classList.remove("on");
        }
      } else {
        enabledSet.add(key);
        chip.classList.add("on");
      }
      showNextCard();
    });

    container.appendChild(chip);
  }
}


/* ---------- 8. Events and start-up ---------- */

function init() {
  // data.js is generated from wordlist.csv; explain clearly if it is missing.
  if (typeof DATA === "undefined") {
    document.getElementById("question").textContent =
      "data.js not found. Run: python3 build_data.py";
    return;
  }

  el.score = document.getElementById("score");
  el.streak = document.getElementById("streak");
  el.question = document.getElementById("question");
  el.word = document.getElementById("word");
  el.answer = document.getElementById("answer");
  el.result = document.getElementById("result");
  el.checkBtn = document.getElementById("check-btn");
  el.nextBtn = document.getElementById("next-btn");
  el.overrideBtn = document.getElementById("override-btn");

  loadProgress();
  buildChips(document.getElementById("question-chips"), QUESTION_LABELS, enabledQuestions);
  buildChips(document.getElementById("tense-chips"), TENSE_LABELS, enabledTenses);

  el.checkBtn.addEventListener("click", checkAnswer);
  el.nextBtn.addEventListener("click", showNextCard);
  el.overrideBtn.addEventListener("click", overrideAsCorrect);

  // Enter in the text box: check the answer, or move on if already checked.
  el.answer.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (hasAnswered) showNextCard();
    else checkAnswer();
  });

  // Enter anywhere else on the page also continues after an answer,
  // unless a button already has focus (pressing Enter on it clicks it).
  document.addEventListener("keydown", event => {
    const focused = document.activeElement;
    if (event.key === "Enter" && hasAnswered &&
        focused !== el.nextBtn && focused !== el.overrideBtn) {
      showNextCard();
    }
  });

  showNextCard();
}

init();
