// questions.js
//
// Format: { id, question, unit, answer, difficulty, hint }
// - answer:     true value as a plain number (scientific notation ok for large values)
// - difficulty: 'easy' | 'medium' | 'hard'
// - hint:       short nudge shown when player clicks "Show hint" (optional)
//
// IMPORTANT — keep `unit` and `answer` in the SAME SCALE.
//   If the unit says "million apps", the player types 1.8 (not 1,800,000),
//   so `answer` must be 1.8 — not 1.8e6. The input box shows the unit label,
//   and scoring compares against `answer` directly.
//
// Add your own below; keep ids incrementing. Verify answers — scoring is log-scale,
// so order of magnitude matters most, but tight calibration rewards precision.
//
// ─────────────────────────────────────────────────────────────────────────────
//  HOW TO ADD A QUESTION
// ─────────────────────────────────────────────────────────────────────────────
//  1. Copy one of the objects below.
//  2. Give it the next incrementing `id` (ids must be unique; order doesn't matter).
//  3. Fill in `question`, `unit` (shown next to the input boxes), and `answer`.
//  4. Tag `difficulty` as 'easy' | 'medium' | 'hard'.
//  5. (Optional) Add a `hint` string — revealed when the player clicks "Show hint".
//
//  Example:
//    { id: 11, question: "How many ...?", unit: "things", answer: 1.5e4,
//      difficulty: "medium", hint: "Decompose by ..." },
//
//  Nothing else needs to change — game.js reads everything from this array.
// ─────────────────────────────────────────────────────────────────────────────

export const QUESTIONS = [
  // ---------- EASY ----------
  { id: 1, question: "How many seconds are in a single day?", unit: "seconds", answer: 86400, difficulty: "easy", hint: "24 hours, 60 minutes each, 60 seconds each." },
  { id: 2, question: "How many bones are in the adult human body?", unit: "bones", answer: 206, difficulty: "easy", hint: "Babies have ~300; many fuse with age." },
  { id: 3, question: "What is the population of New York City (city proper)?", unit: "million people", answer: 8.26, difficulty: "easy", hint: "Largest US city; think under 10 million." },
  { id: 4, question: "How many keys are on a standard full-size piano?", unit: "keys", answer: 88, difficulty: "easy", hint: "52 white, 36 black." },

  // ---------- MEDIUM ----------
  { id: 5, question: "How many apps are available on the Apple App Store?", unit: "million apps", answer: 1.8, difficulty: "medium", hint: "Millions, but fewer than you'd guess after de-duplication." },
  { id: 6, question: "How many commercial airline flights take off worldwide per day?", unit: "flights", answer: 100000, difficulty: "medium", hint: "Roughly 100k — decompose by major hubs." },
  { id: 7, question: "How many gallons of water does an Olympic pool hold?", unit: "gallons", answer: 660000, difficulty: "medium", hint: "50m x 25m x 2m, then convert." },
  { id: 8, question: "How many heartbeats does an average human have in a lifetime?", unit: "beats", answer: 2500000000, difficulty: "medium", hint: "~70 bpm over ~75 years." },

  // ---------- HARD ----------
  { id: 9, question: "How many atoms are in a single grain of table salt?", unit: "atoms", answer: 1.2e18, difficulty: "hard", hint: "Grain mass ~0.06mg; use molar mass + Avogadro." },
  { id: 10, question: "How many cups of tea are drunk in the UK each day?", unit: "million cups", answer: 100, difficulty: "hard", hint: "~67M people, a few cups each on average." }
];