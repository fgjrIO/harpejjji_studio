/******************************************************
 * chordPalette.js
 *
 * Manages an array of chord slots (up to 8). Each chord
 * has a name and a list of keys (x, y, noteName, octave).
 *
 * Also handles:
 *  - Recording notes into a chord slot (R)
 *  - Clearing a slot (C)
 *  - Renaming (N)
 *  - Saving to file (S)
 *  - Sending to library (L)
 *  - Press/Strum logic for chord playback
 ******************************************************/

import {
    keysState,
    getNoteName,
    getNoteOctave,
    noteToFrequency,
    numberOfFrets,
    numberOfStrings,
    keyMode,
    fadeNotes
  } from "./globals.js";
  
  import {
    createOscillator,
    stopOscillator,
    activeUserOscillators
  } from "./audio.js";
  
  import { drawTablature } from "./tablature.js";
  
  /**
   * The chordSlots array has 8 chord objects:
   *   { name: string, keys: [ { x, y, noteName, octave } ] }
   */
  export let chordSlots = Array(8).fill(null).map((_, i) => ({
    name: `Chord ${i+1}`,
    keys: []
  }));
  
  /**
   * chordRecordIndex indicates which slot (0..7) we're recording into.
   * -1 => not currently recording
   */
  export let chordRecordIndex = -1;
  
  /******************************************************
   * toggleChordRecord(index):
   * Toggles recording mode for chordSlots[index].
   ******************************************************/
  export function toggleChordRecord(index) {
    chordRecordIndex = (chordRecordIndex === index) ? -1 : index;
    updateChordPaletteUI();
  }
  
  /******************************************************
   * clearChordNotes(index):
   * Empties the chordSlots[index].keys array.
   ******************************************************/
  export function clearChordNotes(index) {
    chordSlots[index].keys = [];
    updateChordPaletteUI();
  }
  
  /******************************************************
   * renameChordSlot(index):
   * Prompts user for a new chord name.
   ******************************************************/
  export function renameChordSlot(index) {
    const newName = prompt("Enter new name for this chord:", chordSlots[index].name);
    if (newName) {
      chordSlots[index].name = newName;
      updateChordPaletteUI();
    }
  }
  
  /******************************************************
   * recordChordNoteIfNeeded(x,y):
   * If chordRecordIndex != -1, add this note to the chord
   * if not already present.
   ******************************************************/
  export function recordChordNoteIfNeeded(x, y) {
    if (chordRecordIndex === -1) return;
    const noteName = getNoteName(x, y);
    const octave   = getNoteOctave(x, y);
    const chord    = chordSlots[chordRecordIndex];
    // Only add if not already in chord
    const exists = chord.keys.some(k => k.x === x && k.y === y);
    if (!exists) {
      chord.keys.push({ x, y, noteName, octave });
      updateChordPaletteUI();
    }
  }
  
  /******************************************************
   * setChordNotesFromKeysState(index):
   * Overwrite chord slot from whichever keys are marked in keysState.
   ******************************************************/
  export function setChordNotesFromKeysState(index) {
    const chord = chordSlots[index];
    chord.keys = [];
    for (let fy = 0; fy < numberOfFrets; fy++) {
      for (let fx = 0; fx < numberOfStrings; fx++) {
        if (keysState[fy][fx].marker) {
          const nn = getNoteName(fx, fy);
          const oct = getNoteOctave(fx, fy);
          chord.keys.push({ x: fx, y: fy, noteName: nn, octave: oct });
        }
      }
    }
    updateChordPaletteUI();
  }
  
  /******************************************************
   * chordPressDown(index):
   * For keyMode="press" chord playing:
   *   We press all keys until chordPressUp() is called.
   ******************************************************/
  export function chordPressDown(chIndex) {
    const chord = chordSlots[chIndex];
    chord.keys.forEach(k => {
      handleKeyDownProgrammatically(k.x, k.y);
    });
  }
  
  export function chordPressUp(chIndex) {
    const chord = chordSlots[chIndex];
    chord.keys.forEach(k => {
      handleKeyUpProgrammatically(k.x, k.y);
    });
  }
  
  /******************************************************
   * chordToggle(index):
   * For "toggle" style chord playing.
   ******************************************************/
  export function chordToggle(chIndex) {
    const chord = chordSlots[chIndex];
    chord.keys.forEach(k => {
      handleKeyDownProgrammatically(k.x, k.y);
      setTimeout(() => {
        handleKeyUpProgrammatically(k.x, k.y);
      }, 300);
    });
  }
  
  /******************************************************
   * chordStrum(index, delayMs=100):
   * Strum from left to right in ascending string order.
   ******************************************************/
  export function chordStrum(chIndex, delayMs=100) {
    const chord = chordSlots[chIndex];
    // Sort by ascending x (string), then y (fret)
    const sorted = chord.keys.slice().sort((a,b) => (a.x - b.x) || (a.y - b.y));
    let i = 0;
    function doNext() {
      if (i >= sorted.length) return;
      const k = sorted[i];
      handleKeyDownProgrammatically(k.x, k.y);
      setTimeout(() => {
        handleKeyUpProgrammatically(k.x, k.y);
      }, 300);
      i++;
      if (i < sorted.length) {
        setTimeout(doNext, delayMs);
      }
    }
    doNext();
  }
  
  /******************************************************
   * clearAllTabMarkers():
   * Clears all markers & states from the tablature.
   ******************************************************/
  export function clearAllTabMarkers() {
    for (let fy = 0; fy < numberOfFrets; fy++) {
      for (let fx = 0; fx < numberOfStrings; fx++) {
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
   * Programmatically press a key as if user clicked it.
   * This is used by chord playback.
   ******************************************************/
  function handleKeyDownProgrammatically(x,y) {
    // Same logic as real handleKeyDown
    const noteName = getNoteName(x, y);
    const octave   = getNoteOctave(x, y);
    const freq     = noteToFrequency(noteName, octave);
  
    const oscObj = createOscillator(freq, window.currentInstrument || "piano");
    activeUserOscillators.set(`${x}_${y}`, oscObj);
  
    if (keyMode === "toggle") {
      const old = keysState[y][x].marker;
      keysState[y][x].marker = !old;
      if (keysState[y][x].marker) {
        const fingerSel = document.getElementById("fingerSelect");
        if (fingerSel && fingerSel.value !== "None") {
          keysState[y][x].finger = fingerSel.value;
        }
      } else {
        keysState[y][x].finger = null;
      }
    } else {
      keysState[y][x].pressing = true;
      keysState[y][x].fading   = false;
      keysState[y][x].fadeOutStart = null;
    }
  
    // Possibly record chord note
    recordChordNoteIfNeeded(x, y);
  
    // Possibly record sequencer note
    import("./sequencer.js").then(({ startNoteRecording }) => {
      startNoteRecording(x, y);
    });
  
    drawTablature();
  }
  
  /******************************************************
   * handleKeyUpProgrammatically(x, y):
   * Programmatically release a key.
   ******************************************************/
  function handleKeyUpProgrammatically(x,y) {
    const keyID = `${x}_${y}`;
    if (activeUserOscillators.has(keyID)) {
      stopOscillator(activeUserOscillators.get(keyID));
      activeUserOscillators.delete(keyID);
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
  
    // Possibly stop sequencer note
    import("./sequencer.js").then(({ stopNoteRecording }) => {
      stopNoteRecording(x, y);
    });
  
    drawTablature();
  }
  
  /******************************************************
   * updateChordPaletteUI():
   * Called whenever we need to refresh the chord palette
   * UI in the HTML.
   ******************************************************/
  export function updateChordPaletteUI() {
    // Show which chord is recording
    const recordBtns = document.querySelectorAll(".chord-record-btn");
    recordBtns.forEach(btn => {
      const idx = parseInt(btn.getAttribute("data-chord-index"),10);
      if (idx === chordRecordIndex) {
        btn.classList.add("ring","ring-offset-2","ring-red-500");
      } else {
        btn.classList.remove("ring","ring-offset-2","ring-red-500");
      }
    });
  
    // Refresh chord-button text
    const chordButtons = document.querySelectorAll(".chord-button");
    chordButtons.forEach(btn => {
      const slotDiv = btn.closest(".chord-slot");
      const idx = parseInt(slotDiv.getAttribute("data-chord-index"),10);
      btn.textContent = chordSlots[idx].name;
    });
  }
  
  /******************************************************
   * saveChordToFile(index):
   * Saves chord slot to a single .json file.
   ******************************************************/
  export function saveChordToFile(index) {
    const chord = chordSlots[index];
    if (!chord.keys.length) {
      alert("Cannot save an empty chord.");
      return;
    }
    const chordName = prompt("Enter a name for this chord:", chord.name);
    if (!chordName) return;
  
    const data = {
      type: "chord",
      name: chordName,
      keys: chord.keys.map(k => ({
        x: k.x,
        y: k.y,
        noteName: k.noteName,
        octave: k.octave
      })),
      timestamp: new Date().toISOString()
    };
  
    const blob = new Blob([JSON.stringify(data)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = chordName + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
  
  /******************************************************
   * sendChordToLibrary(index):
   * Saves chord slot to the library (localStorage),
   * optionally capturing a snippet image.
   ******************************************************/
  export function sendChordToLibrary(index) {
    const chord = chordSlots[index];
    if (!chord.keys.length) {
      alert("Cannot send an empty chord to library.");
      return;
    }
    const chordName = prompt("Enter a name for this chord:", chord.name);
    if (!chordName) return;
  
    chordSlots[index].name = chordName;
  
    const chordImage = captureChordImage(chord) || null;
  
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
      model: document.getElementById("modelSelect")?.value || null,
      image: chordImage
    };
  
    const savedSelections = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
    savedSelections.push(data);
    localStorage.setItem("harpejjiSelections", JSON.stringify(savedSelections));
  
    // Refresh library UI
    import("./library.js").then(({ populateLibrary }) => {
      populateLibrary();
    });
  }
  
  /******************************************************
   * captureChordImage(chord):
   * Takes a bounding box around the chord's keys in the
   * current tablature SVG and returns a base64 SVG snippet.
   ******************************************************/
  function captureChordImage(chord) {
    if (!chord.keys || !chord.keys.length) return null;
    let minX = Math.min(...chord.keys.map(k => k.x));
    let maxX = Math.max(...chord.keys.map(k => k.x));
    let minY = Math.min(...chord.keys.map(k => k.y));
    let maxY = Math.max(...chord.keys.map(k => k.y));
  
    // Expand bounding box by 2
    minX = Math.max(0, minX - 2);
    maxX = Math.min(numberOfStrings-1, maxX + 2);
    minY = Math.max(0, minY - 2);
    maxY = Math.min(numberOfFrets-1, maxY + 2);
  
    const tablatureSvg = document.getElementById("tablature");
    if (!tablatureSvg) return null;
  
    // Calculate geometry
    const totalWidth = parseFloat(tablatureSvg.getAttribute("width")) || 0;
    const totalHeight = parseFloat(tablatureSvg.getAttribute("height")) || 0;
  
    // Convert row->y coords
    const yTop = totalHeight - ((maxY * window.fretSpacing) + window.fretSpacing/2) - window.keyHeight;
    const yBottom = totalHeight - ((minY * window.fretSpacing) + window.fretSpacing/2);
    const chordHeight = yBottom - yTop;
  
    const xLeft = (minX * window.stringSpacing) + window.stringSpacing - 7.5;
    const xRight = (maxX * window.stringSpacing) + window.stringSpacing + 7.5;
    const chordWidth = xRight - xLeft;
  
    const clonedSvg = tablatureSvg.cloneNode(true);
    clonedSvg.setAttribute("viewBox", `${xLeft} ${yTop} ${chordWidth} ${chordHeight}`);
    clonedSvg.setAttribute("width", chordWidth);
    clonedSvg.setAttribute("height", chordHeight);
  
    const svgData = new XMLSerializer().serializeToString(clonedSvg);
    return "data:image/svg+xml;base64," + btoa(svgData);
  }
  