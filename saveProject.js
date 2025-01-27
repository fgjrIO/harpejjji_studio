/******************************************************
 * saveProject.js
 *
 * Provides two main functions:
 *   saveHighLevelProject() => exports a comprehensive
 *     snapshot of the entire app into a single file
 *   loadHighLevelProject() => imports such a file,
 *     restoring the entire state (model, keysState,
 *     library items, chord slots, sequencer notes,
 *     advanced config, synth settings, etc.)
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
import { getSynthSettingsFromDOM } from "./audio.js";

/******************************************************
* saveHighLevelProject():
* Gathers:
*  - keysState + currentModel
*  - library (harpejjiSelections in localStorage)
*  - chordSlots
*  - sequencer notes (recordedNotes)
*  - advanced config (colors, fade, overlays, etc.)
*  - loadedScales
*  - **Synth Settings** (the new multi-osc + filter + LFO, etc.)
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
  keys: ch.keys.slice(),
  favorite: ch.favorite || false,
  tags: ch.tags || "",
  image: ch.image || null
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
const modelData = {
  numberOfStrings: currentModel.numberOfStrings,
  numberOfFrets: currentModel.numberOfFrets,
  startNote: currentModel.startNote,
  startOctave: currentModel.startOctave,
  endNote: currentModel.endNote,
  endOctave: currentModel.endOctave
};
const keysStateCopy = JSON.parse(JSON.stringify(keysState));

// gather the *current* synth settings from the DOM
// (imported from audio.js)
const synthSettings = getSynthSettingsFromDOM();

// Combine into a single object
const projectData = {
  advancedOptions,
  library: libraryData,
  chordPalette,
  sequencerData,
  scalesData,
  keysState: keysStateCopy,
  currentModel: modelData,
  showNotes,
  currentScale,
  currentRoot,
  keyMode,
  synthSettings // <- The new piece
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
* loadHighLevelProject():
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
  if (typeof ao.rowSpacing === "number") setFretSpacing(ao.rowSpacing);
  if (ao.scaleHighlightColor) setScaleHighlightColor(ao.scaleHighlightColor);
  if (typeof ao.scaleHighlightAlpha === "number") setScaleHighlightAlpha(ao.scaleHighlightAlpha);
  if (ao.scaleHighlightMode) setScaleHighlightMode(ao.scaleHighlightMode);
  if (ao.fingerOverlayColor) setFingerOverlayColor(ao.fingerOverlayColor);
  if (typeof ao.fadeNotes === "boolean") setFadeNotes(ao.fadeNotes);
  if (typeof ao.fadeTime === "number") setFadeTime(ao.fadeTime);
  if (ao.blackKeyColor) setBlackKeyColor(ao.blackKeyColor);
  if (ao.scaleOverlayType) setScaleOverlayType(ao.scaleOverlayType);
  if (ao.starOverlayMode) setStarOverlayMode(ao.starOverlayMode);
  if (typeof ao.starSize === "number") setStarSize(ao.starSize);
}

// library
if (Array.isArray(data.library)) {
  localStorage.setItem("harpejjiSelections", JSON.stringify(data.library));
  populateLibrary();
}

// chord palette
if (Array.isArray(data.chordPalette)) {
  chordSlots.forEach((slot, idx) => {
    if (data.chordPalette[idx]) {
      slot.name = data.chordPalette[idx].name || slot.name;
      slot.keys = Array.isArray(data.chordPalette[idx].keys) ? data.chordPalette[idx].keys : [];
      slot.favorite = !!data.chordPalette[idx].favorite;
      slot.tags = data.chordPalette[idx].tags || "";
      slot.image = data.chordPalette[idx].image || null;
    }
  });
  updateChordPaletteUI();
}

// sequencer
if (data.sequencerData) {
  const seqData = data.sequencerData;
  if (typeof seqData.bpm === "number") SEQUENCER_CONFIG.bpm = seqData.bpm;
  if (typeof seqData.beatsPerBar === "number") SEQUENCER_CONFIG.beatsPerBar = seqData.beatsPerBar;
  if (typeof seqData.totalBars === "number") SEQUENCER_CONFIG.totalBars = seqData.totalBars;
  if (typeof seqData.pixelsPerBeat === "number") SEQUENCER_CONFIG.pixelsPerBeat = seqData.pixelsPerBeat;
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

// Model
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

if (typeof data.showNotes === "boolean") setShowNotes(data.showNotes);
if (data.currentScale) setCurrentScale(data.currentScale);
if (data.currentRoot) setCurrentRoot(data.currentRoot);
if (data.keyMode) setKeyMode(data.keyMode);

// If there are saved synth settings, apply them to the DOM
if (data.synthSettings) {
  applySynthSettingsToDOM(data.synthSettings);
}

// Re-draw
drawTablature();
drawPianoRoll();
drawSequencerGrid();
}

/**
* applySynthSettingsToDOM(synthObj)
*  - Writes the values into the various DOM fields
*    so the user sees them, and subsequent new notes
*    will use these parameters.
*/
function applySynthSettingsToDOM(synthObj) {
// Osc1
if (document.getElementById("osc1WaveType")) {
  document.getElementById("osc1WaveType").value = synthObj.osc1?.wave || "sawtooth";
}
if (document.getElementById("osc1PulseWidth")) {
  document.getElementById("osc1PulseWidth").value = (synthObj.osc1?.pulseWidth || 0.5) * 100;
}
if (document.getElementById("osc1Tune")) {
  document.getElementById("osc1Tune").value = synthObj.osc1?.tune || 0;
}
if (document.getElementById("osc1Mix")) {
  document.getElementById("osc1Mix").value = (synthObj.osc1?.mix || 0.5) * 100;
}
if (document.getElementById("osc1Track")) {
  document.getElementById("osc1Track").checked = !!synthObj.osc1?.track;
}
if (document.getElementById("osc1Sync")) {
  document.getElementById("osc1Sync").checked = !!synthObj.osc1?.sync;
}

// Osc2
if (document.getElementById("osc2WaveType")) {
  document.getElementById("osc2WaveType").value = synthObj.osc2?.wave || "sawtooth";
}
if (document.getElementById("osc2PulseWidth")) {
  document.getElementById("osc2PulseWidth").value = (synthObj.osc2?.pulseWidth || 0.5) * 100;
}
if (document.getElementById("osc2Tune")) {
  document.getElementById("osc2Tune").value = synthObj.osc2?.tune || 0;
}
if (document.getElementById("osc2Mix")) {
  document.getElementById("osc2Mix").value = (synthObj.osc2?.mix || 0.5) * 100;
}
if (document.getElementById("osc2Track")) {
  document.getElementById("osc2Track").checked = !!synthObj.osc2?.track;
}
if (document.getElementById("osc2Sync")) {
  document.getElementById("osc2Sync").checked = !!synthObj.osc2?.sync;
}

// Noise
if (document.getElementById("noiseOn")) {
  document.getElementById("noiseOn").checked = !!synthObj.noiseOn;
}
if (document.getElementById("noiseMix")) {
  document.getElementById("noiseMix").value = (synthObj.noiseMix || 0) * 100;
}

// LFO
if (document.getElementById("lfoRouting")) {
  document.getElementById("lfoRouting").value = synthObj.lfo?.routing || "amplitude";
}
if (document.getElementById("lfoWave")) {
  document.getElementById("lfoWave").value = synthObj.lfo?.wave || "triangle";
}
if (document.getElementById("lfoFrequency")) {
  document.getElementById("lfoFrequency").value = synthObj.lfo?.frequency || 5.0;
}
if (document.getElementById("lfoDepth")) {
  document.getElementById("lfoDepth").value = (synthObj.lfo?.depth || 0.5) * 100;
}

// Glide & Unison
if (document.getElementById("glideOn")) {
  document.getElementById("glideOn").checked = !!synthObj.glideOn;
}
if (document.getElementById("glideTime")) {
  document.getElementById("glideTime").value = synthObj.glideTime || 0.2;
}
if (document.getElementById("unisonOn")) {
  document.getElementById("unisonOn").checked = !!synthObj.unisonOn;
}
if (document.getElementById("unisonVoices")) {
  document.getElementById("unisonVoices").value = synthObj.unisonVoices || 1;
}

// Filters
if (document.getElementById("filter1Cutoff")) {
  document.getElementById("filter1Cutoff").value = (synthObj.filter1?.cutoff || 2000) / 1000; // Hz->kHz
}
if (document.getElementById("filter1Resonance")) {
  document.getElementById("filter1Resonance").value = (synthObj.filter1?.resonance || 0) * 100;
}
if (document.getElementById("filter1EnvAmount")) {
  document.getElementById("filter1EnvAmount").value = (synthObj.filter1?.envAmount || 0.5) * 100;
}

if (document.getElementById("filter2Cutoff")) {
  document.getElementById("filter2Cutoff").value = (synthObj.filter2?.cutoff || 2000) / 1000;
}
if (document.getElementById("filter2Resonance")) {
  document.getElementById("filter2Resonance").value = (synthObj.filter2?.resonance || 0) * 100;
}
if (document.getElementById("filter2EnvAmount")) {
  document.getElementById("filter2EnvAmount").value = (synthObj.filter2?.envAmount || 0.5) * 100;
}

// Filter Env
if (document.getElementById("filterEnvA")) {
  document.getElementById("filterEnvA").value = synthObj.filterEnv?.a || 0.1;
}
if (document.getElementById("filterEnvD")) {
  document.getElementById("filterEnvD").value = synthObj.filterEnv?.d || 0.3;
}
if (document.getElementById("filterEnvS")) {
  document.getElementById("filterEnvS").value = (synthObj.filterEnv?.s || 0.7) * 100;
}
if (document.getElementById("filterEnvR")) {
  document.getElementById("filterEnvR").value = synthObj.filterEnv?.r || 0.5;
}

// Amp Env
if (document.getElementById("ampEnvA")) {
  document.getElementById("ampEnvA").value = synthObj.ampEnv?.a || 0.01;
}
if (document.getElementById("ampEnvD")) {
  document.getElementById("ampEnvD").value = synthObj.ampEnv?.d || 0.2;
}
if (document.getElementById("ampEnvS")) {
  document.getElementById("ampEnvS").value = (synthObj.ampEnv?.s || 0.5) * 100;
}
if (document.getElementById("ampEnvR")) {
  document.getElementById("ampEnvR").value = synthObj.ampEnv?.r || 0.5;
}
}
