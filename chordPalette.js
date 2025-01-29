/******************************************************
 * chordPalette.js
 *
 * Manages:
 *  - 8 chord slots, each with {name, keys[], favorite, tags, image}
 *  - Recording notes (button "R")
 *  - Clearing chord notes (button "C")
 *  - Renaming chord (button "N")
 *  - Saving to file (button "S") => now includes "model"
 *  - Sending chord to library (button "L") => also includes "model"
 *  - Press/Toggle/Strum logic for playing chord
 *  - The "i" info button to open a popup for viewing/editing
 *    favorite, tags, and the chord’s image.
 ******************************************************/

import {
  keysState,
  getNoteName,
  getNoteOctave,
  noteToFrequency,
  numberOfFrets,
  numberOfStrings,
  keyMode,
  fadeNotes,
  currentInstrument,
  fretSpacing,
  stringSpacing,
  keyHeight,
  initKeysState
} from "./globals.js";

import { createOscillator, stopOscillator, activeUserOscillators } from "./audio.js";
import { drawTablature } from "./tablature.js";

/**
 * The chordSlots array of 8 chord objects:
 *   {
 *     name: `Chord ${i+1}`,
 *     keys: [ { x, y, noteName, octave } ],
 *     favorite: false,
 *     tags: "",
 *     image: null
 *   }
 */
export let chordSlots = Array(8).fill(null).map((_, i) => ({
  name: `Chord ${i+1}`,
  keys: [],
  favorite: false,
  tags: "",
  image: null
}));

/**
 * chordRecordIndex => which chord slot is currently recording (-1 if none).
 */
export let chordRecordIndex = -1;

/******************************************************
 * toggleChordRecord(index):
 *   If chordRecordIndex is the same, set to -1 (off).
 *   Else set it to `index`.
 ******************************************************/
export function toggleChordRecord(index) {
  chordRecordIndex = (chordRecordIndex === index) ? -1 : index;
  updateChordPaletteUI();
}

/******************************************************
 * clearChordNotes(index):
 *   Empties a chord slot.
 ******************************************************/
export function clearChordNotes(index) {
  chordSlots[index].keys = [];
  chordSlots[index].image = null; // discard old image if any
  updateChordPaletteUI();
}

/******************************************************
 * renameChordSlot(index):
 *   Prompt user for new name
 ******************************************************/
export function renameChordSlot(index) {
  const newName = prompt("Enter new name for this chord:", chordSlots[index].name);
  if (newName) {
    chordSlots[index].name = newName;
    updateChordPaletteUI();
  }
}

/******************************************************
 * recordChordNoteIfNeeded(x, y):
 *   If chordRecordIndex>=0, add that note to the chord slot
 *   if not already present.
 ******************************************************/
export function recordChordNoteIfNeeded(x, y) {
  if (chordRecordIndex === -1) return;
  const noteName = getNoteName(x, y);
  const octave   = getNoteOctave(x, y);
  const chord    = chordSlots[chordRecordIndex];

  const already = chord.keys.some(k => k.x === x && k.y === y);
  if (!already) {
    chord.keys.push({ x, y, noteName, octave });
    // Clear the old chord image since the notes changed
    chord.image = null; 
    updateChordPaletteUI();
  }
}

/******************************************************
 * setChordNotesFromKeysState(index):
 *   Overwrite chord slot from whichever keys are marked.
 ******************************************************/
export function setChordNotesFromKeysState(index) {
  const chord = chordSlots[index];
  chord.keys = [];
  for (let fy = 0; fy < numberOfFrets; fy++){
    for (let fx = 0; fx < numberOfStrings; fx++){
      if (keysState[fy][fx].marker) {
        chord.keys.push({
          x: fx,
          y: fy,
          noteName: getNoteName(fx, fy),
          octave: getNoteOctave(fx, fy)
        });
      }
    }
  }
  chord.image = null; // new chord => discard old image
  updateChordPaletteUI();
}

/******************************************************
 * chordPressDown(index):
 *   If chordMode="press" and keyMode="press",
 *   press & hold all notes until chordPressUp().
 ******************************************************/
export async function chordPressDown(index) {
  const chord = chordSlots[index];
  for (const k of chord.keys) {
    await handleKeyDownProgrammatically(k.x, k.y);
  }
}

/******************************************************
 * chordPressUp(index):
 *   Release all notes.
 ******************************************************/
export function chordPressUp(index) {
  const chord = chordSlots[index];
  chord.keys.forEach(k => {
    handleKeyUpProgrammatically(k.x, k.y);
  });
}

/******************************************************
 * chordToggle(index):
 *   If chordMode="press" + keyMode="toggle",
 *   we do a quick press & release of each note with a short delay.
 ******************************************************/
export async function chordToggle(index) {
  const chord = chordSlots[index];
  for (const k of chord.keys) {
    await handleKeyDownProgrammatically(k.x, k.y);
    setTimeout(() => {
      handleKeyUpProgrammatically(k.x, k.y);
    }, 300);
  }
}

/******************************************************
 * chordStrum(index, delayMs):
 *   Sort chord keys left->right, press them in sequence.
 ******************************************************/
export async function chordStrum(index, delayMs = 100) {
  const chord = chordSlots[index];
  // sort by ascending x, then y
  const sorted = chord.keys.slice().sort((a,b) => (a.x - b.x) || (a.y - b.y));

  for (const k of sorted) {
    await handleKeyDownProgrammatically(k.x, k.y);
    setTimeout(() => {
      handleKeyUpProgrammatically(k.x, k.y);
    }, 300);
    if (sorted.indexOf(k) < sorted.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

/******************************************************
 * chordStrumNAndPress: used for strum2press, strum3press
 ******************************************************/
async function chordStrumNAndPress(index, n, delayMs = 100) {
  const chord = chordSlots[index];
  const sorted = chord.keys.slice().sort((a,b) => (a.x - b.x) || (a.y - b.y));
  if (!sorted.length) return;

  if (sorted.length <= n) {
    return chordStrum(index, delayMs);
  }

  // 1) Strum the first N notes individually
  for (let i = 0; i < n; i++) {
    const k = sorted[i];
    await handleKeyDownProgrammatically(k.x, k.y);
    setTimeout(() => {
      handleKeyUpProgrammatically(k.x, k.y);
    }, 300);
    if (i < n - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // 2) Wait one strum interval
  await new Promise(resolve => setTimeout(resolve, delayMs));

  // 3) Press remainder simultaneously
  const remainder = sorted.slice(n);
  remainder.forEach(k => {
    handleKeyDownProgrammatically(k.x, k.y);
  });

  // 4) Release them all after ~300ms
  setTimeout(() => {
    remainder.forEach(k => {
      handleKeyUpProgrammatically(k.x, k.y);
    });
  }, 300);
}

export async function chordStrum2AndPress(index, delayMs = 100) {
  return chordStrumNAndPress(index, 2, delayMs);
}

export async function chordStrum3AndPress(index, delayMs = 100) {
  return chordStrumNAndPress(index, 3, delayMs);
}

/******************************************************
 * clearAllTabMarkers():
 *   Clears all "marker", "pressing", etc. from keysState.
 ******************************************************/
export function clearAllTabMarkers() {
  for (let fy = 0; fy < numberOfFrets; fy++){
    for (let fx = 0; fx < numberOfStrings; fx++){
      keysState[fy][fx].marker = false;
      keysState[fy][fx].pressing = false;
      keysState[fy][fx].finger = null;
      keysState[fy][fx].fading = false;
      keysState[fy][fx].fadeOutStart = null;
    }
  }
  drawTablature();
}

/******************************************************
 * handleKeyDownProgrammatically(x, y):
 *   Press a key as if the user clicked it.
 ******************************************************/
async function handleKeyDownProgrammatically(x, y) {
  const noteName = getNoteName(x, y);
  const octave   = getNoteOctave(x, y);
  const freq     = noteToFrequency(noteName, octave);

  const oscObj = await createOscillator(freq, currentInstrument);
  activeUserOscillators.set(`${x}_${y}`, oscObj);

  if (keyMode === "toggle") {
    const old = keysState[y][x].marker;
    keysState[y][x].marker = !old;
  } else {
    keysState[y][x].pressing = true;
    keysState[y][x].fading   = false;
    keysState[y][x].fadeOutStart = null;
  }

  recordChordNoteIfNeeded(x, y);

  // sequencer record
  import("./sequencer.js").then(({ startNoteRecording }) => {
    startNoteRecording(x, y);
  });

  drawTablature();
}

/******************************************************
 * handleKeyUpProgrammatically(x, y):
 *   Release a key as if user mouseup.
 ******************************************************/
function handleKeyUpProgrammatically(x, y) {
  const keyStr= `${x}_${y}`;
  if (activeUserOscillators.has(keyStr)) {
    stopOscillator(activeUserOscillators.get(keyStr));
    activeUserOscillators.delete(keyStr);
  }

  if (keyMode === "press") {
    if (fadeNotes) {
      keysState[y][x].pressing = false;
      keysState[y][x].fading   = true;
      keysState[y][x].fadeOutStart = performance.now();
    } else {
      keysState[y][x].pressing = false;
    }
  }

  // stop sequencer note
  import("./sequencer.js").then(({ stopNoteRecording }) => {
    stopNoteRecording(x, y);
  });

  drawTablature();
}

/******************************************************
 * updateChordPaletteUI():
 *   Refreshes the chord slot UI elements,
 *   highlighting the currently recording slot,
 *   updating chord names, etc.
 ******************************************************/
export function updateChordPaletteUI() {
  const recordBtns = document.querySelectorAll(".chord-record-btn");
  recordBtns.forEach(btn => {
    const idx = parseInt(btn.getAttribute("data-chord-index"), 10);
    if (idx === chordRecordIndex) {
      btn.classList.add("ring", "ring-offset-2", "ring-red-500");
    } else {
      btn.classList.remove("ring", "ring-offset-2", "ring-red-500");
    }
  });

  const chordButtons = document.querySelectorAll(".chord-button");
  chordButtons.forEach(btn => {
    const slotDiv = btn.closest(".chord-slot");
    const idx = parseInt(slotDiv.getAttribute("data-chord-index"), 10);
    btn.textContent = chordSlots[idx].name;
  });

  // Wire up info button clicks for the popup
  document.querySelectorAll(".chord-info-btn").forEach(infoBtn => {
    infoBtn.onclick = () => {
      const idx = parseInt(infoBtn.getAttribute("data-chord-index"), 10);
      openChordInfoPopup(idx);
    };
  });
}

/******************************************************
 * saveChordToFile(index):
 *   Exports chord data => .json file, capturing
 *   a fresh chord image with blue circle notes.
 ******************************************************/
export function saveChordToFile(index) {
  const chord = chordSlots[index];
  if (!chord.keys.length) {
    alert("Cannot save an empty chord.");
    return;
  }
  const chordName = prompt("Enter name for this chord:", chord.name);
  if (!chordName) return;

  chord.name = chordName;

  // Capture chord image
  const chordImage = captureChordImage(chord);
  chord.image = chordImage;

  // Grab current model
  const currentModelSelect = document.getElementById("modelSelect");
  const chordModel = currentModelSelect ? currentModelSelect.value : null;

  const data = {
    type: "chord",
    name: chordName,
    keys: chord.keys.map(k => ({
      x: k.x,
      y: k.y,
      noteName: k.noteName,
      octave: k.octave
    })),
    timestamp: new Date().toISOString(),
    image: chordImage,
    favorite: chord.favorite || false,
    tags: chord.tags || "",
    model: chordModel
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = chordName + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

/******************************************************
 * sendChordToLibrary(index):
 *   Adds chord to localStorage library, capturing
 *   an image snippet with the blue circles.
 ******************************************************/
export function sendChordToLibrary(index) {
  const chord = chordSlots[index];
  if (!chord.keys.length) {
    alert("Cannot send an empty chord to library.");
    return;
  }
  const chordName = prompt("Enter a name for this chord:", chord.name);
  if (!chordName) return;

  chord.name = chordName;

  // Capture chord image
  const chordImage = captureChordImage(chord);
  chord.image = chordImage;

  // Grab current model
  const currentModelSelect = document.getElementById("modelSelect");
  const chordModel = currentModelSelect ? currentModelSelect.value : null;

  const data = {
    type: "chord",
    name: chordName,
    keys: chord.keys.map(k => ({
      x: k.x,
      y: k.y,
      noteName: k.noteName,
      octave: k.octave
    })),
    timestamp: new Date().toISOString(),
    model: chordModel,
    image: chordImage,
    favorite: chord.favorite || false,
    tags: chord.tags || ""
  };

  const saved = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
  saved.push(data);
  localStorage.setItem("harpejjiSelections", JSON.stringify(saved));

  import("./library.js").then(({ populateLibrary }) => {
    populateLibrary();
  });
}

/******************************************************
 * captureChordImage(chord):
 *   1) Save current board state
 *   2) Clear board
 *   3) Mark chord keys => drawTablature => bounding-box
 *   4) Restore board => drawTablature
 *   5) Return base64 SVG
 ******************************************************/
export function captureChordImage(chord) {
  if (!chord.keys || !chord.keys.length) return null;

  // Save old board
  const oldKeys = JSON.parse(JSON.stringify(keysState));

  // Clear & mark chord
  initKeysState();
  chord.keys.forEach(k => {
    if (
      k.x >= 0 && k.x < numberOfStrings &&
      k.y >= 0 && k.y < numberOfFrets
    ) {
      keysState[k.y][k.x].marker = true;
    }
  });
  drawTablature();

  // Determine bounding box from chord keys
  let minX = Math.min(...chord.keys.map(k => k.x));
  let maxX = Math.max(...chord.keys.map(k => k.x));
  let minY = Math.min(...chord.keys.map(k => k.y));
  let maxY = Math.max(...chord.keys.map(k => k.y));

  // Expand bounding box slightly
  minX = Math.max(0, minX - 2);
  maxX = Math.min(numberOfStrings - 1, maxX + 2);
  minY = Math.max(0, minY - 2);
  maxY = Math.min(numberOfFrets - 1, maxY + 2);

  // Get the <svg> and sizes
  const svg = document.getElementById("tablature");
  if (!svg) {
    // restore
    restoreOldBoard(oldKeys);
    return null;
  }

  const totalWidth  = parseFloat(svg.getAttribute("width")) || 0;
  const totalHeight = parseFloat(svg.getAttribute("height")) || 0;

  // Convert row->y coords 
  const yTop    = totalHeight - ((maxY * fretSpacing) + fretSpacing/2) - keyHeight;
  const yBottom = totalHeight - ((minY * fretSpacing) + fretSpacing/2);
  const chordHeight = yBottom - yTop;

  const xLeft  = (minX * stringSpacing) + stringSpacing - 7.5;
  const xRight = (maxX * stringSpacing) + stringSpacing + 7.5;
  const chordWidth = xRight - xLeft;

  // Clone the current <svg> content in that bounding box
  const cloned = svg.cloneNode(true);
  cloned.setAttribute("viewBox", `${xLeft} ${yTop} ${chordWidth} ${chordHeight}`);
  cloned.setAttribute("width", chordWidth);
  cloned.setAttribute("height", chordHeight);

  const svgData = new XMLSerializer().serializeToString(cloned);
  const chordImage = "data:image/svg+xml;base64," + btoa(svgData);

  // restore original board
  restoreOldBoard(oldKeys);

  return chordImage;
}

function restoreOldBoard(oldKeys) {
  for (let y = 0; y < oldKeys.length; y++) {
    for (let x = 0; x < oldKeys[y].length; x++) {
      keysState[y][x] = oldKeys[y][x];
    }
  }
  drawTablature();
}

/******************************************************
 * openChordInfoPopup(index):
 *   Displays chord's image, favorite check, tags, etc.
 ******************************************************/
function openChordInfoPopup(index) {
  const chord = chordSlots[index];
  const popup = document.getElementById("chordInfoPopup");
  if (!popup) return;

  const imgEl = document.getElementById("chordInfoImage");
  if (chord.image) {
    imgEl.src = chord.image;
    imgEl.classList.remove("hidden");
  } else {
    imgEl.src = "";
    imgEl.classList.add("hidden");
  }

  const favEl = document.getElementById("chordInfoFavorite");
  favEl.checked = !!chord.favorite;

  const tagsEl = document.getElementById("chordInfoTags");
  tagsEl.value = chord.tags || "";

  const saveBtn = document.getElementById("saveChordInfoBtn");
  saveBtn.onclick = () => {
    chord.favorite = favEl.checked;
    chord.tags = tagsEl.value.trim();
    popup.classList.add("hidden");
  };

  const closeBtn = document.getElementById("closeChordInfoPopup");
  closeBtn.onclick = () => {
    popup.classList.add("hidden");
  };

  popup.classList.remove("hidden");
}
