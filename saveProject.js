/******************************************************
 * saveProject.js
 *
 * Provides two main functions:
 *   saveHighLevelProject()  => exports a comprehensive
 *     snapshot of the entire app into a single file
 *   loadHighLevelProject()  => imports such a file,
 *     restoring the entire state (model, keysState,
 *     library items, chord slots, sequencer notes,
 *     advanced config, etc.)
 ******************************************************/

import {
  // From globals
  keysState,
  currentModel,
  showNotes,
  currentScale,
  currentRoot,
  keyMode,
  loadedScales,

  fretSpacing,
  blackKeyColor,
  fingerOverlayColor,
  scaleHighlightColor,
  scaleHighlightAlpha,
  scaleHighlightMode,
  scaleOverlayType,
  starOverlayMode,
  starSize,
  fadeNotes,
  fadeTime,

  setCurrentModel,
  initKeysState,
  setShowNotes,
  setCurrentScale,
  setCurrentRoot,
  setKeyMode,

  setFretSpacing,
  setBlackKeyColor,
  setFingerOverlayColor,
  setScaleHighlightColor,
  setScaleHighlightAlpha,
  setScaleHighlightMode,
  setScaleOverlayType,
  setStarOverlayMode,
  setStarSize,
  setFadeNotes,
  setFadeTime
} from "./globals.js";

import {
  chordSlots,
  updateChordPaletteUI
} from "./chordPalette.js";

import {
  populateLibrary
} from "./library.js";

import {
  recordedNotes,
  SEQUENCER_CONFIG,
  pitchMappings,
  stopPlayback,
  drawSequencerGrid,
  drawPianoRoll
} from "./sequencer.js";

import { drawTablature } from "./tablature.js";

/** NEW: import these to handle synth params */
import { getSynthParams, setSynthParams } from "./audio.js";

/******************************************************
 * saveHighLevelProject():
 * Gathers:
 *  - keysState + currentModel
 *  - library (harpejjiSelections in localStorage)
 *  - chordSlots
 *  - sequencer notes (recordedNotes)
 *  - advanced config (colors, fade, overlays, etc.)
 *  - loadedScales
 *  - NOW: also saves the synthParams
 ******************************************************/
export function saveHighLevelProject() {
  // advanced config
  const advancedOptions = {
    cursorColor: document.getElementById("playhead")?.style.backgroundColor || "#ffffff",
    rowSpacing: fretSpacing,
    scaleHighlightColor,
    scaleHighlightAlpha,
    scaleHighlightMode,
    fingerOverlayColor,
    fadeNotes,
    fadeTime,
    blackKeyColor,
    scaleOverlayType,
    starOverlayMode,
    starSize
  };

  // library
  const libraryData = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");

  // chord palette
  const chordPalette = chordSlots.map(ch => ({
    name: ch.name,
    keys: ch.keys.slice()
  }));

  // sequencer
  const sequencerData = {
    bpm: SEQUENCER_CONFIG.bpm,
    beatsPerBar: SEQUENCER_CONFIG.beatsPerBar,
    totalBars: SEQUENCER_CONFIG.totalBars,
    pixelsPerBeat: SEQUENCER_CONFIG.pixelsPerBeat,
    notes: recordedNotes.slice(),
    pitchMappings: { ...pitchMappings }
  };

  // scales
  const scalesData = { ...loadedScales };

  // keysState + model
  const projectData = {
    advancedOptions,
    library: libraryData,
    chordPalette,
    sequencerData,
    scalesData,
    keysState: JSON.parse(JSON.stringify(keysState)), // deep copy
    currentModel: {
      // we store just the object from globals
      numberOfStrings: currentModel.numberOfStrings,
      numberOfFrets: currentModel.numberOfFrets,
      startNote: currentModel.startNote,
      startOctave: currentModel.startOctave,
      endNote: currentModel.endNote,
      endOctave: currentModel.endOctave
    },
    showNotes,
    currentScale,
    currentRoot,
    keyMode,

    /****************************************
     * NEW: include the current synth params
     ****************************************/
    synthParams: getSynthParams()
  };

  // Convert to JSON and download
  const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "harpejji_project.json";
  a.click();
  URL.revokeObjectURL(url);
}

/******************************************************
 * loadHighLevelProject(file):
 * Reads a .json from disk. The user typically picks
 * it from an <input type="file" />, then calls this.
 ******************************************************/
export function loadHighLevelProject() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = (evt) => {
    const file = evt.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        applyProjectData(data);
        alert("Project loaded successfully.");
      } catch (err) {
        alert("Error loading project: " + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/******************************************************
 * applyProjectData(data):
 * The actual logic to set all states from the loaded file.
 ******************************************************/
function applyProjectData(data) {
  stopPlayback();

  // advancedOptions
  if (data.advancedOptions) {
    const ao = data.advancedOptions;
    if (ao.cursorColor) {
      const playheadEl = document.getElementById("playhead");
      if (playheadEl) playheadEl.style.backgroundColor = ao.cursorColor;
    }
    if (typeof ao.rowSpacing === "number") {
      setFretSpacing(ao.rowSpacing);
    }
    if (ao.scaleHighlightColor) {
      setScaleHighlightColor(ao.scaleHighlightColor);
    }
    if (typeof ao.scaleHighlightAlpha === "number") {
      setScaleHighlightAlpha(ao.scaleHighlightAlpha);
    }
    if (ao.scaleHighlightMode) {
      setScaleHighlightMode(ao.scaleHighlightMode);
    }
    if (ao.fingerOverlayColor) {
      setFingerOverlayColor(ao.fingerOverlayColor);
    }
    if (typeof ao.fadeNotes === "boolean") {
      setFadeNotes(ao.fadeNotes);
    }
    if (typeof ao.fadeTime === "number") {
      setFadeTime(ao.fadeTime);
    }
    if (ao.blackKeyColor) {
      setBlackKeyColor(ao.blackKeyColor);
    }
    if (ao.scaleOverlayType) {
      setScaleOverlayType(ao.scaleOverlayType);
    }
    if (ao.starOverlayMode) {
      setStarOverlayMode(ao.starOverlayMode);
    }
    if (typeof ao.starSize === "number") {
      setStarSize(ao.starSize);
    }
  }

  // library
  if (Array.isArray(data.library)) {
    localStorage.setItem("harpejjiSelections", JSON.stringify(data.library));
    populateLibrary();
  }

  // chord palette
  if (Array.isArray(data.chordPalette)) {
    chordSlots.forEach((slot, idx)=>{
      if (data.chordPalette[idx]) {
        slot.name= data.chordPalette[idx].name || slot.name;
        slot.keys= Array.isArray(data.chordPalette[idx].keys) ? data.chordPalette[idx].keys : [];
      }
    });
    updateChordPaletteUI();
  }

  // sequencer
  if (data.sequencerData) {
    const seqData = data.sequencerData;
    if (typeof seqData.bpm === "number") {
      SEQUENCER_CONFIG.bpm= seqData.bpm;
    }
    if (typeof seqData.beatsPerBar === "number") {
      SEQUENCER_CONFIG.beatsPerBar= seqData.beatsPerBar;
    }
    if (typeof seqData.totalBars === "number") {
      SEQUENCER_CONFIG.totalBars= seqData.totalBars;
    }
    if (typeof seqData.pixelsPerBeat === "number") {
      SEQUENCER_CONFIG.pixelsPerBeat= seqData.pixelsPerBeat;
    }
    if (Array.isArray(seqData.notes)) {
      recordedNotes.splice(0, recordedNotes.length, ...seqData.notes);
    }
    if (seqData.pitchMappings) {
      Object.assign(pitchMappings, seqData.pitchMappings);
    }
    stopPlayback();
    drawSequencerGrid();
  }

  // scales
  if (data.scalesData) {
    Object.keys(data.scalesData).forEach(name => {
      loadedScales[name] = data.scalesData[name];
    });
  }

  // model
  if (data.currentModel) {
    const cm = data.currentModel;
    setCurrentModel({
      numberOfStrings: cm.numberOfStrings,
      numberOfFrets: cm.numberOfFrets,
      startNote: cm.startNote,
      startOctave: cm.startOctave,
      endNote: cm.endNote,
      endOctave: cm.endOctave
    });
  }

  // Then restore keysState using the new model dimensions
  if (data.keysState && Array.isArray(data.keysState)) {
    initKeysState();
    for (let y = 0; y < data.keysState.length && y < currentModel.numberOfFrets; y++) {
      for (let x = 0; x < data.keysState[y].length && x < currentModel.numberOfStrings; x++) {
        keysState[y][x] = data.keysState[y][x];
      }
    }
  }

  // showNotes, currentScale, currentRoot, keyMode
  if (typeof data.showNotes === "boolean") {
    setShowNotes(data.showNotes);
  }
  if (data.currentScale) {
    setCurrentScale(data.currentScale);
  }
  if (data.currentRoot) {
    setCurrentRoot(data.currentRoot);
  }
  if (data.keyMode) {
    setKeyMode(data.keyMode);
  }

  /***************************************************
   * NEW: Restore the saved synth params, if any
   ***************************************************/
  if (data.synthParams) {
    setSynthParams(data.synthParams);
  }

  // Re-draw
  drawTablature();
  drawPianoRoll();
  drawSequencerGrid();
}
