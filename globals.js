/******************************************************
 * globals.js
 *
 * Shared global config, constants, and state for the entire app,
 * including various get/set utilities and note helpers.
 ******************************************************/

// A list of note names used in the app.
export const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

/**
 * Default built-in scales (by step intervals).
 * Can be extended/overridden by "Import Scales" in advanced config.
 */
export let loadedScales = {
  "Major": [2,2,1,2,2,2,1],
  "Minor": [2,1,2,2,1,2,2],
  "Harmonic Major": [2,2,1,2,1,3,1]
};

/**
 * Instrument wave types used by audio.js
 */
export const instrumentMap = {
  piano: "sine",
  guitar: "triangle",
  ukulele: "square",
  harp: "sawtooth"
};

/**
 * Chord definitions for the "Find Chord" feature.
 */
export const CHORD_DEFINITIONS = [
  { name: "Major", intervals: [0,4,7] },
  { name: "Minor", intervals: [0,3,7] },
  { name: "Dim",   intervals: [0,3,6] },
  { name: "Aug",   intervals: [0,4,8] },
  { name: "Maj7",  intervals: [0,4,7,11] },
  { name: "Min7",  intervals: [0,3,7,10] },
  { name: "Dom7",  intervals: [0,4,7,10] },
  { name: "Sus2",  intervals: [0,2,7] },
  { name: "Sus4",  intervals: [0,5,7] },
  { name: "6",     intervals: [0,4,7,9] },
  { name: "m6",    intervals: [0,3,7,9] },
  { name: "6/9",   intervals: [0,4,7,9,2] },
  { name: "m6/9",  intervals: [0,3,7,9,2] },
  { name: "Maj9",  intervals: [0,4,7,11,2] },
  { name: "Min9",  intervals: [0,3,7,10,2] },
  { name: "13",    intervals: [0,4,7,10,2,5,9] },
  { name: "Maj13", intervals: [0,4,7,11,2,5,9] },
  { name: "Min13", intervals: [0,3,7,10,2,5,9] },
  { name: "Add9",  intervals: [0,4,7,2] },
  { name: "mAdd9", intervals: [0,3,7,2] },
  { name: "(#9)", intervals: [0, 3, 4, 7,10] },
  { name: "Maj11 (no.2)", intervals: [0, 4, 5, 7, 11] },
  { name: "Maj11", intervals: [0, 2, 4, 5, 7, 11] },
  { name: "7Sus4", intervals: [0, 5, 7, 11] },
  { name: "9Sus4", intervals: [0, 2, 5, 7, 11] },
  { name: "6/9Sus4", intervals: [0, 2, 5, 7, 9] },
  { name: "9Sus4", intervals: [0, 2, 5, 7, 11] }
];

/**
 * Models define Harpejji-like layouts: number of frets, strings, etc.
 */
export const MODELS = {
  K24: {
    numberOfStrings: 24,
    numberOfFrets: 15,
    startNote: "A",
    startOctave: 0,
    endNote: "A",
    endOctave: 5
  },
  G16: {
    numberOfStrings: 16,
    numberOfFrets: 19,
    startNote: "C",
    startOctave: 2,
    endNote: "C",
    endOctave: 6
  },
  G12: {
    numberOfStrings: 12,
    numberOfFrets: 15,
    startNote: "C",
    startOctave: 2,
    endNote: "C#",
    endOctave: 5
  }
};

/**
 * The current model (default K24), plus derived numeric values.
 */
export let currentModel = MODELS.K24;
export let numberOfFrets = currentModel.numberOfFrets;
export let numberOfStrings = currentModel.numberOfStrings;
export let BASE_NOTE = currentModel.startNote;
export let BASE_OCTAVE = currentModel.startOctave;

/**
 * keysState[y][x] => object with marker, pressing, etc.
 */
export let keysState = [];

/**
 * Initializes keysState based on the current model shape.
 */
export function initKeysState() {
  keysState = [];
  for (let y = 0; y < numberOfFrets; y++) {
    keysState[y] = [];
    for (let x = 0; x < numberOfStrings; x++) {
      keysState[y][x] = {
        marker: false,
        pressing: false,
        sequencerPlaying: false,
        finger: null,
        fading: false,
        fadeOutStart: null
      };
    }
  }
}

/**
 * showNotes => whether to label note names on the tablature
 */
export let showNotes = false;

/**
 * currentInstrument => "piano", "guitar", etc.
 */
export let currentInstrument = "piano";

/**
 * scale highlight config: scale name + root
 */
export let currentScale = "none";
export let currentRoot = "A";

export let scaleHighlightColor = "#ffc107";
export let scaleHighlightAlpha = 0.3;
export let scaleHighlightMode = "fill";  // fill, outline, both

/**
 * star vs. keys overlay, etc.
 */
export let scaleOverlayType = "keys";    // "keys" or "star"
export let starOverlayMode = "fill";     // fill, outline, both
export let starSize = 8;

/**
 * fingerOverlayColor => color of finger text in the circle
 */
export let fingerOverlayColor = "#000000";

/**
 * fadeNotes => whether "press" mode notes fade on release
 * fadeTime => how many seconds
 */
export let fadeNotes = false;
export let fadeTime = 1.0;

/**
 * keyMode => "toggle" or "press"
 */
export let keyMode = "toggle";

/**
 * Layout geometry for the tablature
 */
export let fretSpacing = 30;
export const stringSpacing = 30;
export const keyHeight = 25;

/**
 * blackKeyColor => color for black notes on the tablature
 */
export let blackKeyColor = "#bcbfc4";
export let highDensity = false;

/******************************************************
 * Setters for changing global variables at runtime
 ******************************************************/

export function setCurrentModel(modelKey) {
  if (!MODELS[modelKey]) return;
  currentModel = MODELS[modelKey];
  numberOfFrets = currentModel.numberOfFrets;
  numberOfStrings = currentModel.numberOfStrings;
  BASE_NOTE = currentModel.startNote;
  BASE_OCTAVE = currentModel.startOctave;
}

export function setCurrentInstrument(instr) {
  currentInstrument = instr;
}

export function setShowNotes(val) {
  showNotes = val;
}

export function setKeyMode(mode) {
  keyMode = mode;
}

export function setFadeNotes(enabled) {
  fadeNotes = enabled;
}
export function setFadeTime(seconds) {
  fadeTime = seconds;
}

export function setFretSpacing(value) {
  fretSpacing = value;
}

export function setBlackKeyColor(color) {
  blackKeyColor = color;
}

export function setHighDensity(enabled) {
  highDensity = enabled;
}

export function setFingerOverlayColor(color) {
  fingerOverlayColor = color;
}

export function setScaleHighlightColor(color) {
  scaleHighlightColor = color;
}
export function setScaleHighlightAlpha(alpha) {
  scaleHighlightAlpha = alpha;
}
export function setScaleHighlightMode(mode) {
  scaleHighlightMode = mode;
}
export function setScaleOverlayType(type) {
  scaleOverlayType = type;
}
export function setStarOverlayMode(mode) {
  starOverlayMode = mode;
}
export function setStarSize(size) {
  starSize = size;
}

export function setCurrentScale(scaleName) {
  currentScale = scaleName;
}
export function setCurrentRoot(rootNote) {
  currentRoot = rootNote;
}

/******************************************************
 * Utility functions
 ******************************************************/

export function mod(n, m) {
  return ((n % m) + m) % m;
}

/**
 * Return the semitone offset from (x=0,y=0).
 * Each column => +2 semitones, each row => +1 semitone.
 */
export function getSemitonesFromBase(x, y) {
  return x*2 + y;
}

/**
 * Return the note name at (x, y) in the current layout.
 */
export function getNoteName(x, y) {
  const baseIdx = NOTES.indexOf(BASE_NOTE);
  const semitones = getSemitonesFromBase(x, y);
  const newIdx = mod(baseIdx + semitones, NOTES.length);
  return NOTES[newIdx];
}

/**
 * Return the octave for the note at (x,y).
 */
export function getNoteOctave(x, y) {
  const baseIdx = NOTES.indexOf(BASE_NOTE);
  const semitones = getSemitonesFromBase(x, y);
  const total = baseIdx + semitones;
  const octShift = Math.floor(total / NOTES.length);
  return BASE_OCTAVE + octShift;
}

/**
 * Check if note name includes a "#".
 */
export function isBlackNote(noteName) {
  return noteName.includes("#");
}

/**
 * Convert a note name + octave => frequency (A4=440).
 */
export function noteToFrequency(noteName, octave) {
  const noteIdx = NOTES.indexOf(noteName);
  if (noteIdx < 0) return 440;
  const A4_OCT = 4;
  const A4_Idx = NOTES.indexOf("A");
  const semitones = (octave - A4_OCT)*12 + (noteIdx - A4_Idx);
  return 440 * Math.pow(2, semitones/12);
}
