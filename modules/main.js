import { appState } from './state.js';
import { audioEngine } from './audio.js';
import { tablature } from './tablature.js';
import { chordManager } from './chords.js';
import { sequencer } from './sequencer.js';

// Initialize all modules
function init() {
  // Initialize tablature with key handlers
  tablature.init(document.getElementById("tablature"), {
    onKeyDown: handleKeyDown,
    onKeyUp: handleKeyUp
  });

  // Initialize modules
  chordManager.init();
  sequencer.init();

  // Draw initial state
  tablature.draw();

  // Setup event listeners
  setupEventListeners();
}

function handleKeyDown(x, y) {
  const noteName = appState.getNoteName(x, y);
  const octave = appState.getNoteOctave(x, y);
  const soundObj = audioEngine.playNote(noteName, octave, appState.currentInstrument);
  appState.activeOscillators.set(`${x}_${y}`, soundObj);

  if (appState.keyMode === 'toggle') {
    appState.toggleMarker(x, y);
    // For toggle mode, stop the note after a short delay
    setTimeout(() => handleKeyUp(x, y), 300);
  } else if (appState.keyMode === 'press') {
    appState.setKeyState(x, y, 'pressing', true);
  }

  if (appState.chordRecordIndex !== -1) {
    appState.addChordNote(x, y);
  }

  // Record note in sequencer if recording
  if (appState.isSequencerModeOn && appState.isRecording) {
    sequencer.recordNote(x, y);
  }

  tablature.draw();
}

function handleKeyUp(x, y) {
  const keyStr = `${x}_${y}`;
  const soundObj = appState.activeOscillators.get(keyStr);
  if (soundObj) {
    soundObj.stop();
    appState.activeOscillators.delete(keyStr);
  }
  if (appState.keyMode === 'press') {
    appState.setKeyState(x, y, 'pressing', false);
    tablature.draw();
  }
}

function setupEventListeners() {
  // Model selection
  const modelSelect = document.getElementById("modelSelect");
  modelSelect.addEventListener("change", () => {
    appState.updateModel(modelSelect.value);
    tablature.draw();
  });

  // Instrument selection
  const instrumentSelect = document.getElementById("instrumentSelect");
  instrumentSelect.addEventListener("change", () => {
    appState.currentInstrument = instrumentSelect.value;
  });

  // Scale selection
  const scaleSelect = document.getElementById("scaleSelect");
  scaleSelect.addEventListener("change", (e) => {
    appState.currentScale = e.target.value;
    tablature.draw();
  });

  // Root selection
  const rootSelect = document.getElementById("rootSelect");
  rootSelect.addEventListener("change", (e) => {
    appState.currentRoot = e.target.value;
    tablature.draw();
  });

  // Toggle notes
  document.getElementById("toggleNotesBtn").addEventListener("click", () => {
    appState.showNotes = !appState.showNotes;
    tablature.draw();
  });

  // Reset markers
  document.getElementById("resetMarkersBtn").addEventListener("click", () => {
    appState.clearAllMarkers();
    tablature.draw();
  });

  // Kill notes
  document.getElementById("killNotesBtn").addEventListener("click", () => {
    for (let [key, soundObj] of appState.activeOscillators.entries()) {
      soundObj.stop();
    }
    appState.activeOscillators.clear();
    tablature.draw();
  });

  // Key mode toggle
  document.getElementById("toggleKeyModeBtn").addEventListener("click", () => {
    if (appState.keyMode === 'toggle') {
      appState.keyMode = 'press';
      document.getElementById('toggleKeyModeBtn').textContent = "Key Mode: Press";
    } else {
      appState.keyMode = 'toggle';
      document.getElementById('toggleKeyModeBtn').textContent = "Key Mode: Toggle";
    }
  });

  // Sequencer mode toggle
  document.getElementById("toggleSequencerModeBtn").addEventListener("click", () => {
    appState.isSequencerModeOn = !appState.isSequencerModeOn;
    const sequencerEl = document.getElementById("sequencer");
    sequencerEl.classList.toggle("hidden", !appState.isSequencerModeOn);
    
    if (appState.isSequencerModeOn) {
      // Reset and show playhead when opening sequencer
      appState.playheadPosition = 0;
      sequencer.updatePlayhead();
      sequencer.drawGrid();
      sequencer.drawPianoRoll();
    } else {
      sequencer.stopPlayback();
    }
  });

  // Effects controls
  document.getElementById('delaySlider').addEventListener('input', (e) => {
    audioEngine.setDelayGain(parseFloat(e.target.value));
  });

  document.getElementById('reverbSlider').addEventListener('input', (e) => {
    audioEngine.setReverbGain(parseFloat(e.target.value));
  });
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", init);
