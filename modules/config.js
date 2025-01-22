// Configuration and Constants
export const loadedScales = {
  "Major": [2, 2, 1, 2, 2, 2, 1],
  "Minor": [2, 1, 2, 2, 1, 2, 2],
};

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

export const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

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
];

export const SEQUENCER_CONFIG = {
  pixelsPerBeat: 100,
  beatsPerBar: 4,
  bpm: 120,
  totalBars: 16,
  noteHeight: 20,
};

// Layout constants
// Layout constants - some need to be mutable
export let fretSpacing = 30;
export const stringSpacing = 30;
export const keyHeight = 25;

// Instrument mapping
export const instrumentMap = {
  piano: "sine",
  guitar: "triangle",
  ukulele: "square",
  harp: "sawtooth"
};
