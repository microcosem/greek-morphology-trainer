/* ==========================================================================
   Greek Noun Practice: app logic
   Depends on nouns_data.js, which defines the global NOUN_DATA object:
     NOUN_DATA.nouns = [{ lemma, declension, gender, translation,
                          forms: [{ form, analyses: [{ case, number, articles }] }] }]
   A noun's "forms" are its distinct spellings. When one spelling serves several
   case/number slots (for example nominative and vocative singular), it is one form
   with several "analyses", and any of them is an acceptable answer.

   Sections: 1. Configuration  2. State  3. Saved progress  4. Text helpers
             5. Lookup tables  6. Choosing a card  7. Grading
             8. Screen updates  9. Events and start-up
   ========================================================================== */
"use strict";


/* ---------- 1. Configuration ---------- */

const STORAGE_KEY = "gnouns1";   // localStorage key for saved progress

const QUESTION_LABELS = {
  declension: "Declension",
  morphology: "Case & number",
  article:    "Article for noun",
  noun:       "Noun for article",
};

const QUESTION_PROMPTS = {
  declension: "What declension is this noun?",
  morphology: "What is the morphology of this form? (case and number)",
  article:    "What article matches this noun form?",
  noun:       "What noun might go with this article?",
};

// Which questions expect the answer typed in Greek letters.
const GREEK_ANSWER = { declension: false, morphology: false, article: true, noun: true };

const DECLENSION_LABELS = { "1": "1st declension", "2": "2nd declension", "3": "3rd declension" };

const CASE_LABELS = {
  nominative: "nominative", genitive: "genitive", dative: "dative",
  accusative: "accusative", vocative: "vocative",
};

const NUMBER_LABELS = { s: "singular", p: "plural" };

const GENDER_LABELS = { m: "masculine", f: "feminine", n: "neuter", c: "masculine or feminine" };

// Spaced-repetition weights: a card's weight is how likely it is to be picked.
const START_WEIGHT = 1;
const MISS_WEIGHT_INCREASE = 2;
const MAX_WEIGHT = 8;
const CORRECT_WEIGHT_FACTOR = 0.5;      // weight is halved after a correct answer
const OVERRIDE_WEIGHT_FACTOR = 0.25;    // used by "Mark as correct"
const MIN_WEIGHT = 0.25;


/* ---------- 2. State ---------- */

const enabledQuestions = new Set(Object.keys(QUESTION_LABELS));
const enabledDeclensions = new Set(Object.keys(DECLENSION_LABELS));

let weights = {};                                // "questionType|cardId" -> weight
let score = { ok: 0, n: 0, streak: 0 };          // ok = correct, n = attempted
let currentCard = null;                          // { questionType, card }
let hasAnswered = false;                         // true after Check, until Next

let NOUNS = [];                                  // NOUN_DATA.nouns, set in init()
const articleEntries = new Map();                // normalised article -> { key, display, nounIndexes }

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

// For comparing Greek answers. Accents, breathings and the iota subscript MUST match;
// only differences that don't change the word are ignored:
//   - macrons (ᾱ vs α), which are hard to type
//   - grave vs acute (τὸν vs τόν), because a final acute turns grave in running text
//   - final sigma ς vs σ
//   - capitals, extra spaces, and how the marks were typed (precomposed or combining)
// So "ἀγορᾶς" matches "ἀγορᾶς" but not "ἀγορας".
function normalizeGreek(text) {
  const decomposed = text
    .normalize("NFD")
    .toLowerCase()
    .replace(/[\u0304\u0306]/g, "")                        // macron, breve
    .replace(/\u0300/g, "\u0301")                           // grave -> acute
    .replace(/\u03c2/g, "\u03c3")                           // final sigma -> sigma
    .replace(/[^\u03b1-\u03c9\u0300-\u036f\s,\/]/g, " ");  // keep Greek letters and marks

  // Put each letter's marks in a fixed order so differently typed input compares equal.
  return decomposed
    .replace(/([\u03b1-\u03c9])([\u0300-\u036f]+)/g,
             (match, letter, marks) => letter + [...marks].sort().join(""))
    .replace(/\s+/g, " ")
    .trim();
}

// The old, forgiving comparison that ignores ALL marks. It is used only to
// notice "right letters, wrong accent" so the feedback can say so.
function normalizeGreekLoose(text) {
  return text
    .normalize("NFD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u03c2/g, "\u03c3")
    .replace(/[^\u03b1-\u03c9\s,\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasGreekLetters(text) {
  return /[\u0370-\u03ff\u1f00-\u1fff]/.test(text);
}

function escapeHtml(text) {
  const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
  return text.replace(/[&<>]/g, char => replacements[char]);
}

function unique(items) {
  return [...new Set(items)];
}

function pickRandom(items, count) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

// [{case:"nominative",number:"s"}, {case:"vocative",number:"s"}, {case:"genitive",number:"p"}]
//   -> "nominative / vocative singular or genitive plural"
function describeAnalyses(analyses) {
  const groups = [];
  ["s", "p"].forEach(number => {
    const cases = unique(analyses.filter(a => a.number === number).map(a => CASE_LABELS[a.case]));
    if (cases.length) groups.push(`${cases.join(" / ")} ${NUMBER_LABELS[number]}`);
  });
  return groups.join(" or ");
}

// Meaning to show for a form: the plural translation if every analysis is plural.
function meaningOf(noun, analyses) {
  const allPlural = analyses.every(a => a.number === "p");
  const text = allPlural && noun.translation.plural ? noun.translation.plural : noun.translation.singular;
  return text ? `“${text}”` : "";
}

function formWithArticleAnalyses(form) {
  return form.analyses.filter(a => a.articles.length > 0);
}


/* ---------- 5. Lookup tables ---------- */

// Built once: for each article, which nouns can take it?
function buildArticleIndex() {
  NOUNS.forEach((noun, nounIndex) => {
    noun.forms.forEach(form => {
      form.analyses.forEach(analysis => {
        analysis.articles.forEach(article => {
          const key = normalizeGreek(article);
          if (!articleEntries.has(key)) {
            articleEntries.set(key, { key, display: article, nounIndexes: new Set() });
          }
          articleEntries.get(key).nounIndexes.add(nounIndex);
        });
      });
    });
  });
}


/* ---------- 6. Choosing a card ----------
   A "card" is a small object describing what to ask:
     declension  { id, nounIndex }                 shows the noun's nominative singular
     morphology  { id, nounIndex, formIndex }      shows one form
     article     { id, nounIndex, formIndex }      shows one form (nom/gen/dat/acc only)
     noun        { id, entry }                     shows one article                    */

function declensionIsEnabled(noun) {
  return enabledDeclensions.has(String(noun.declension));
}

function cardsFor(questionType) {
  const cards = [];

  if (questionType === "noun") {
    articleEntries.forEach(entry => {
      const fitsEnabledDeclension = [...entry.nounIndexes].some(n => declensionIsEnabled(NOUNS[n]));
      if (fitsEnabledDeclension) cards.push({ id: "t" + entry.key, entry });
    });
    return cards;
  }

  NOUNS.forEach((noun, nounIndex) => {
    if (!declensionIsEnabled(noun)) return;

    if (questionType === "declension") {
      cards.push({ id: `d${nounIndex}`, nounIndex });
      return;
    }
    noun.forms.forEach((form, formIndex) => {
      if (questionType === "article" && formWithArticleAnalyses(form).length === 0) return;
      cards.push({ id: `${questionType[0]}${nounIndex}.${formIndex}`, nounIndex, formIndex });
    });
  });
  return cards;
}

function weightOf(questionType, cardId) {
  const saved = weights[questionType + "|" + cardId];
  return saved === undefined ? START_WEIGHT : saved;
}

// Random pick where higher-weight (recently missed) cards are more likely.
function pickWeighted(cards, questionType) {
  const cardWeights = cards.map(card => weightOf(questionType, card.id));
  const total = cardWeights.reduce((sum, w) => sum + w, 0);

  let remaining = Math.random() * total;
  for (let i = 0; i < cards.length; i++) {
    remaining -= cardWeights[i];
    if (remaining <= 0) return cards[i];
  }
  return cards[cards.length - 1];
}

// The Greek text shown on the card.
function wordToShow(questionType, card) {
  if (questionType === "noun") return card.entry.display;
  const noun = NOUNS[card.nounIndex];
  return questionType === "declension" ? noun.lemma : noun.forms[card.formIndex].form;
}

function showNextCard() {
  const askable = [...enabledQuestions].filter(type => cardsFor(type).length > 0);

  if (askable.length === 0) {
    el.question.textContent = "No cards match these filters. Turn on more declensions or question types.";
    el.word.textContent = "";
    return;
  }

  const questionType = askable[Math.floor(Math.random() * askable.length)];
  const card = pickWeighted(cardsFor(questionType), questionType);
  currentCard = { questionType, card };
  hasAnswered = false;

  el.question.textContent = QUESTION_PROMPTS[questionType];
  el.word.textContent = wordToShow(questionType, card);
  el.answer.placeholder = GREEK_ANSWER[questionType]
    ? "Type in Greek (accents and breathings needed)"
    : "Type your answer";
  el.answer.value = "";
  el.answer.disabled = false;
  el.result.innerHTML = "";

  el.checkBtn.classList.remove("hidden");
  el.nextBtn.classList.add("hidden");
  el.overrideBtn.classList.add("hidden");

  el.answer.focus();
  updateScoreDisplay();
}


/* ---------- 7. Grading ----------
   Each grader takes (answer, card) and returns:
     ok      true if the answer is accepted
     correct the answer shown to the learner
     note    an optional explanation shown under it
   `answer` is the trimmed answer exactly as typed. */

function gradeDeclension(answer, card) {
  const noun = NOUNS[card.nounIndex];
  const text = answer.toLowerCase();

  let guess = 0;
  if (/first|1/.test(text)) guess = 1;
  else if (/second|2/.test(text)) guess = 2;
  else if (/third|3/.test(text)) guess = 3;

  // Genitive singular is the form that gives the declension away.
  const genitive = noun.forms.find(f => f.analyses.some(a => a.case === "genitive" && a.number === "s"));
  const genitiveNote = genitive ? ` Genitive singular: ${genitive.form}.` : "";
  const meaning = noun.translation.singular ? ` “${noun.translation.singular}”,` : "";

  return {
    ok: guess === noun.declension,
    correct: DECLENSION_LABELS[noun.declension],
    note: `${noun.lemma}:${meaning} ${GENDER_LABELS[noun.gender] || "gender unknown"}.${genitiveNote}`,
  };
}

function gradeMorphology(answer, card) {
  const noun = NOUNS[card.nounIndex];
  const form = noun.forms[card.formIndex];
  const text = answer.toLowerCase();

  // Every case word the learner typed ("nom", "genitive", ...).
  const typedCases = [];
  [["nominative", /nom/], ["genitive", /gen/], ["dative", /dat/],
   ["accusative", /acc/], ["vocative", /voc/]].forEach(([name, pattern]) => {
    if (pattern.test(text)) typedCases.push(name);
  });

  // The number: "pl" / "plural", "sg" / "sing" / "singular", or a lone "s" / "p".
  const saysPlural = /pl|\bp\b/.test(text);
  const saysSingular = /sg|sing|\bs\b/.test(text);
  let typedNumber = "";
  if (saysPlural && !saysSingular) typedNumber = "p";
  else if (saysSingular && !saysPlural) typedNumber = "s";

  // A spelling can serve several slots, so any listed analysis is accepted.
  let ok = typedCases.length > 0 && typedCases.every(name =>
    form.analyses.some(a => a.case === name && (typedNumber === "" || a.number === typedNumber)));
  if (ok && saysPlural && saysSingular) ok = false;

  let note = `${noun.lemma} ${meaningOf(noun, form.analyses)}`.trim();
  if (ok && typedNumber === "") {
    note = "Correct. Next time, also give the number (singular or plural). " + note;
  } else if (ok && form.analyses.length > 1) {
    note = "This spelling has more than one reading; any of them is accepted. " + note;
  }
  return { ok, correct: describeAnalyses(form.analyses), note };
}

function gradeArticle(answer, card) {
  const noun = NOUNS[card.nounIndex];
  const form = noun.forms[card.formIndex];
  const slots = formWithArticleAnalyses(form);

  // Articles that agree with this form, with the slot each one belongs to.
  const accepted = new Map();   // normalised article -> { display, analyses }
  slots.forEach(analysis => {
    analysis.articles.forEach(article => {
      const key = normalizeGreek(article);
      if (!accepted.has(key)) accepted.set(key, { display: article, analyses: [] });
      accepted.get(key).analyses.push(analysis);
    });
  });

  const typed = normalizeGreek(answer).split(/[,\/\s]+/).filter(Boolean);
  const ok = typed.length > 0 && typed.every(piece => accepted.has(piece));

  // Show each article with the slot it belongs to when there is more than one.
  const entries = [...accepted.values()];
  const descriptions = unique(entries.map(e => describeAnalyses(e.analyses)));
  let correct;
  if (entries.length === 1) correct = entries[0].display;
  else if (descriptions.length === 1) correct = entries.map(e => e.display).join(" or ");   // e.g. ὁ or ἡ
  else correct = entries.map(e => `${e.display} (${describeAnalyses(e.analyses)})`).join(" or ");

  let note = `${form.form} is ${describeAnalyses(slots)} (${GENDER_LABELS[noun.gender] || "gender unknown"}): ${meaningOf(noun, slots)}`;
  if (!ok && !hasGreekLetters(answer)) {
    note += " Type the article in Greek letters.";
  } else if (!ok) {
    const looseAccepted = new Set(entries.map(e => normalizeGreekLoose(e.display)));
    const typedLoose = normalizeGreekLoose(answer).split(/[,\/\s]+/).filter(Boolean);
    if (typedLoose.length > 0 && typedLoose.every(piece => looseAccepted.has(piece))) {
      note += " The letters are right, but accents and breathing marks are required.";
    }
  }
  return { ok, correct, note };
}

// True if the answer is a form of a noun that takes this article when marks are ignored.
function looseMatchExists(answer, entry) {
  let words = normalizeGreekLoose(answer).split(/\s+/).filter(Boolean);
  const looseArticles = new Set([...articleEntries.values()].map(e => normalizeGreekLoose(e.display)));
  if (words.length > 1 && looseArticles.has(words[0])) words = words.slice(1);
  const typed = words.join(" ");
  return typed !== "" && [...entry.nounIndexes].some(n =>
    NOUNS[n].forms.some(f => normalizeGreekLoose(f.form) === typed));
}

function gradeNounForArticle(answer, card) {
  const entry = card.entry;

  // Let the learner type the article too ("ἡ ἀγορά").
  let words = normalizeGreek(answer).split(/\s+/).filter(Boolean);
  if (words.length > 1 && articleEntries.has(words[0])) words = words.slice(1);
  const typed = words.join(" ");

  // Every noun in the list that takes this article, and the forms that fit it exactly.
  const fitting = [];                // { noun, form, analysis }
  entry.nounIndexes.forEach(nounIndex => {
    NOUNS[nounIndex].forms.forEach(form => {
      form.analyses.forEach(analysis => {
        if (analysis.articles.some(a => normalizeGreek(a) === entry.key)) {
          fitting.push({ noun: NOUNS[nounIndex], form, analysis });
        }
      });
    });
  });

  // Accept any form of a noun that can take this article.
  const matchedNoun = typed === "" ? null :
    [...entry.nounIndexes].map(n => NOUNS[n]).find(noun =>
      noun.forms.some(f => normalizeGreek(f.form) === typed)) || null;
  const ok = matchedNoun !== null;
  const exactFit = ok && fitting.some(x => x.noun === matchedNoun && normalizeGreek(x.form.form) === typed);

  const examples = pickRandom(fitting, 4).map(x => `${x.form.form} (${x.noun.translation.singular || x.noun.lemma})`);
  const correct = "e.g. " + examples.join(", ");

  let note = `${entry.display} is ${describeAnalyses(unique(fitting.map(x => x.analysis)))}.`;
  if (ok && !exactFit) {
    const exact = fitting.filter(x => x.noun === matchedNoun).map(x => x.form.form);
    note += ` ${matchedNoun.lemma} takes this article, but the form that goes with it is ${unique(exact).join(" / ")}.`;
  } else if (!ok && !hasGreekLetters(answer)) {
    note += " Type the noun in Greek letters.";
  } else if (!ok && looseMatchExists(answer, entry)) {
    note += " The letters are right, but accents and breathing marks are required.";
  } else if (!ok) {
    const other = NOUNS.find(noun => noun.forms.some(f => normalizeGreek(f.form) === typed));
    if (other) note += ` ${other.lemma} (${GENDER_LABELS[other.gender] || "gender unknown"}) does not go with this article.`;
    else note += " That word is not in the list. If it is a valid noun, use “Mark as correct”.";
  }
  return { ok, correct, note };
}

const GRADERS = {
  declension: gradeDeclension,
  morphology: gradeMorphology,
  article: gradeArticle,
  noun: gradeNounForArticle,
};

function gradeCurrentAnswer() {
  const { card, questionType } = currentCard;
  return GRADERS[questionType](el.answer.value.trim(), card);
}


/* ---------- 8. Screen updates ---------- */

function updateScoreDisplay() {
  el.score.textContent = `${score.ok} / ${score.n} correct`;
  el.streak.textContent = score.streak > 1 ? `Streak: ${score.streak}` : "";
}

// Record a result and adjust how often this card will come back.
function recordResult(isCorrect) {
  const { questionType, card } = currentCard;
  const key = questionType + "|" + card.id;
  const weight = weightOf(questionType, card.id);

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
  const { questionType, card } = currentCard;
  const key = questionType + "|" + card.id;
  const weight = weightOf(questionType, card.id);

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


/* ---------- 9. Events and start-up ---------- */

function init() {
  // nouns_data.js is generated from nounlist.csv; explain clearly if it is missing.
  if (typeof NOUN_DATA === "undefined") {
    document.getElementById("question").textContent =
      "nouns_data.js not found. Run: python3 build_data.py";
    return;
  }
  NOUNS = NOUN_DATA.nouns;
  buildArticleIndex();

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
  buildChips(document.getElementById("declension-chips"), DECLENSION_LABELS, enabledDeclensions);

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
