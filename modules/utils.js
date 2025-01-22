import { NOTES } from './config.js';

// Utility Functions
export function mod(n, m) {
  return ((n % m) + m) % m;
}

export function noteToFrequency(noteName, octave) {
  const noteIndex = NOTES.indexOf(noteName);
  if (noteIndex === -1) return 440; 
  const A4_OCTAVE = 4;
  const A4_INDEX = NOTES.indexOf("A");
  const semitones = (octave - A4_OCTAVE) * 12 + (noteIndex - A4_INDEX);
  return 440 * Math.pow(2, semitones / 12);
}

export function getSemitonesFromBase(x, y) {
  return (x * 2) + (y * 1);
}

export function isBlackNote(noteName) {
  return noteName.includes("#");
}

export function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

// SVG Helper Functions
export function createSVGElement(type, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", type);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}
