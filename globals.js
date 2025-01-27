/******************************************************
 * globals.js
 *
 * Defines global variables and helper functions:
 *  - keysState
 *  - numberOfStrings, numberOfFrets, etc.
 *  - fadeNotes, fadeTime
 *  - scaleOverlay config (stars, fill, outline, etc.)
 *  - showNotes, keyMode
 *  - currentModel, currentInstrument, etc.
 *  - getNoteName(), getNoteOctave(), noteToFrequency()
 ******************************************************/

/******************************************************
 * Basic musical constants
 ******************************************************/
export const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
export const BASE_NOTE = "C";
export const BASE_OCTAVE = 0;

export function mod(n,m) {
  return ((n % m) + m) % m;
}

/******************************************************
 * Keys, models, showNotes, scale overlays, etc.
 ******************************************************/
export let numberOfStrings = 24;
export let numberOfFrets   = 24;
export let showNotes = false;
export let keyMode = "toggle";  // "toggle" or "press"
export let highDensity = false;

export let scaleOverlayType = "keys";  // "keys" or "star"
export let starOverlayMode  = "fill";  // "fill","outline","both"
export let starSize         = 8;

export let scaleHighlightColor = "#ffc107";
export let scaleHighlightAlpha = 0.3;
export let scaleHighlightMode  = "fill"; // fill, outline, both

export let fingerOverlayColor = "#000000";
export let blackKeyColor      = "#bcbfc4";

export let fadeNotes = false;
export let fadeTime  = 1.0; // seconds

export const loadedScales = {};

// Our tablature geometry
export let fretSpacing   = 30; // default row spacing
export const stringSpacing = 15;
export const keyHeight     = 25;

/******************************************************
 * keysState[y][x] => an object with:
 *   marker: boolean
 *   pressing: boolean
 *   fading: boolean
 *   fadeOutStart: number
 *   sequencerPlaying: boolean
 *   finger: string or null
 ******************************************************/
export let keysState = [];

/******************************************************
 * currentModel:
 *  - numberOfStrings
 *  - numberOfFrets
 *  - startNote, startOctave
 *  - endNote, endOctave
 *
 * We store some defaults for e.g. K24, etc.
 ******************************************************/
const models = {
  "K24": {
    numberOfStrings: 24,
    numberOfFrets: 24,
    startNote: "A",
    startOctave: 0,
    endNote: "A",
    endOctave: 5
  },
  "G16": {
    numberOfStrings: 16,
    numberOfFrets: 25,
    startNote: "C",
    startOctave: 2,
    endNote: "C",
    endOctave: 6
  },
  "G12": {
    numberOfStrings: 12,
    numberOfFrets: 28,
    startNote: "C",
    startOctave: 2,
    endNote: "C#",
    endOctave: 5
  }
};

export let currentModel = {
  ...models["K24"]
};

/******************************************************
 * currentInstrument:
 * Now we only have one option, "synth"
 ******************************************************/
export let currentInstrument = "synth";

/******************************************************
 * initKeysState():
 * Rebuilds the keysState array based on currentModel
 ******************************************************/
export function initKeysState() {
  numberOfStrings = currentModel.numberOfStrings;
  numberOfFrets   = currentModel.numberOfFrets;
  keysState = [];
  for (let y=0; y<numberOfFrets; y++){
    let row = [];
    for (let x=0; x<numberOfStrings; x++){
      row.push({
        marker: false,
        pressing: false,
        fading: false,
        fadeOutStart: null,
        sequencerPlaying: false,
        finger: null
      });
    }
    keysState.push(row);
  }
}

/******************************************************
 * setHighDensity(value):
 ******************************************************/
export function setHighDensity(value) {
  highDensity = value;
}

/******************************************************
 * setCurrentModel(modelNameOrObj):
 * If a string, we load from 'models' map.
 * If an object, we assume it has .numberOfStrings etc.
 ******************************************************/
export function setCurrentModel(modelNameOrObj) {
  if (typeof modelNameOrObj === "string") {
    if (models[modelNameOrObj]) {
      currentModel = { ...models[modelNameOrObj] };
    }
  } else {
    // assume user passed in custom object
    currentModel = { ...modelNameOrObj };
  }
}

/******************************************************
 * setCurrentInstrument(instrument):
 * We only support "synth".
 ******************************************************/
export function setCurrentInstrument(instrument) {
  // For safety, if something else is passed:
  currentInstrument = "synth";
}

/******************************************************
 * setShowNotes(value):
 ******************************************************/
export function setShowNotes(value) {
  showNotes = value;
}

/******************************************************
 * setKeyMode(value):
 ******************************************************/
export function setKeyMode(value) {
  keyMode = value;
}

/******************************************************
 * setScaleOverlayType(value):
 ******************************************************/
export function setScaleOverlayType(value) {
  scaleOverlayType = value;
}

/******************************************************
 * setStarOverlayMode(value):
 ******************************************************/
export function setStarOverlayMode(value) {
  starOverlayMode = value;
}

/******************************************************
 * setStarSize(value):
 ******************************************************/
export function setStarSize(value) {
  starSize = value;
}

/******************************************************
 * setScaleHighlightColor(value):
 ******************************************************/
export function setScaleHighlightColor(value) {
  scaleHighlightColor = value;
}

/******************************************************
 * setScaleHighlightAlpha(value):
 ******************************************************/
export function setScaleHighlightAlpha(value) {
  scaleHighlightAlpha = value;
}

/******************************************************
 * setScaleHighlightMode(value):
 ******************************************************/
export function setScaleHighlightMode(value) {
  scaleHighlightMode = value;
}

/******************************************************
 * setFingerOverlayColor(value):
 ******************************************************/
export function setFingerOverlayColor(value) {
  fingerOverlayColor = value;
}

/******************************************************
 * setBlackKeyColor(value):
 ******************************************************/
export function setBlackKeyColor(value) {
  blackKeyColor = value;
}

/******************************************************
 * setFadeNotes(value):
 ******************************************************/
export function setFadeNotes(value) {
  fadeNotes = value;
}

/******************************************************
 * setFadeTime(value):
 ******************************************************/
export function setFadeTime(value) {
  fadeTime = value;
}

/******************************************************
 * setFretSpacing(value):
 ******************************************************/
export function setFretSpacing(value) {
  fretSpacing = value;
}

/******************************************************
 * currentScale + currentRoot
 ******************************************************/
export let currentScale = "none";
export let currentRoot  = "A";
export function setCurrentScale(scale) {
  currentScale = scale;
}
export function setCurrentRoot(root) {
  currentRoot = root;
}

/******************************************************
 * getNoteName(x, y):
 * Figure out the note name for key (x,y) based on
 * currentModel's startNote, etc.
 ******************************************************/
export function getNoteName(x,y){
  const startN = NOTES.indexOf(currentModel.startNote);
  const startOct = currentModel.startOctave;

  // x= string index, y= fret index
  // We'll do a simple approach where each string is a semitone up from the previous,
  // or each fret is a semitone? There's some custom logic typically,
  // but let's keep it simple for this sample code.
  const semitonesFromBase = (y * 1) + (x * 1) + (startN - NOTES.indexOf(BASE_NOTE));
  const noteIndex = mod(NOTES.indexOf(BASE_NOTE) + semitonesFromBase, 12);
  return NOTES[noteIndex];
}

/******************************************************
 * getNoteOctave(x,y):
 ******************************************************/
export function getNoteOctave(x,y){
  const startN = NOTES.indexOf(currentModel.startNote);
  const startOct = currentModel.startOctave;
  const semitonesFromBase = (y * 1) + (x * 1) + (startN - NOTES.indexOf(BASE_NOTE));
  const totalSemitonesFromC0 = (startOct - BASE_OCTAVE)*12 + semitonesFromBase;
  const octaveOffset = Math.floor(totalSemitonesFromC0 / 12);
  return BASE_OCTAVE + octaveOffset;
}

/******************************************************
 * noteToFrequency(noteName, octave):
 * Basic 12-TET formula with A4=440 if you like,
 * or any other approach. We'll do a simple version.
 ******************************************************/
export function noteToFrequency(noteName, octave){
  // We'll assume A4=440 approach
  const A4_index = NOTES.indexOf("A");
  const A4_octave = 4;
  const nIndex = NOTES.indexOf(noteName);

  // semitones from A4
  const semitonesFromA4 = (octave - A4_octave)*12 + (nIndex - A4_index);
  return 440 * Math.pow(2, semitonesFromA4/12);
}
