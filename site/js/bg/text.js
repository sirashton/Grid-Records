// The words of the Bulgaria story, kept apart from the figures and charts in
// ./story.js. Each entry is a string, or a function of the story context
// (ctx: figs, rows, first, last, latest, row(year), at(slot), installed, and
// the formatters n0, gw, hrs, eur, twh, hh, fmtDate) that returns one. An
// entry left null is hidden on the page, so the charts can ship before the
// words. Every number must come from ctx (storyFigures, tested) or from a
// source that is linked.
//
// The prose is still to be written: the figures and sources for it are in
// the project notes (five-countries/bg-story-brief.md).

export const CHAPTERS = [
  'Lignite and the exports',
  'When lignite runs, and what it is paid',
  'Batteries move noon solar to the evening',
  'The evening peak, year by year',
  'What is coming, and which records it moves',
];

export const TEXT = {
  lede: null,
  answerLead: null,
  // Three supporting points, as HTML strings linking to the chapters.
  answerPoints: null,
  // The headline figure and fact list above the chapters, as HTML.
  facts: null,
  hint: null,
  take1: null,
  body1: null,
  take2: null,
  body2: null,
  take3: null,
  body3: null,
  take4: null,
  body4: null,
  take5: null,
  body5: null,
  // [when, what, source url, record to watch]
  coming: null,
};
