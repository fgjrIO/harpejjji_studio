import { MODELS, NOTES, SEQUENCER_CONFIG, fretSpacing } from './config.js';
import { mod, getSemitonesFromBase } from './utils.js';

class AppState {
  constructor() {
    // Model state
    this.currentModel = MODELS.K24;
    this.numberOfFrets = this.currentModel.numberOfFrets;
    this.numberOfStrings = this.currentModel.numberOfStrings;
    this.BASE_NOTE = this.currentModel.startNote;
    this.BASE_OCTAVE = this.currentModel.startOctave;
    this.fretSpacing = fretSpacing;
    this.activeOscillators = new Map();

    // UI state
    this.showNotes = false;
    this.keyMode = 'toggle';
    this.currentInstrument = "piano";
    this.currentScale = "none";
    this.currentRoot = "A";
    this.scaleHighlightColor = "#ffc107";
    this.scaleHighlightAlpha = 0.3;

    // Grid state
    this.keysState = this.initKeysState();

    // Chord state
    this.chordSlots = Array(8).fill(null).map((_, i) => ({
      name: `Chord ${i+1}`,
      keys: []
    }));
    this.chordRecordIndex = -1;

    // Sequencer state
    this.isSequencerModeOn = false;
    this.isPlaying = false;
    this.isRecording = false;
    this.metronomeEnabled = false;
    this.currentBeat = 0;
    this.recordedNotes = [];
    this.activeNotes = new Map();
    this.playheadPosition = 0;
    this.audioStartTime = 0;
    this.isStepMode = false;
    this.stepModeTime = 0.0;

    // Sequencer config
    this.SEQUENCER_CONFIG = {
      pixelsPerBeat: 100,
      beatsPerBar: 4,
      bpm: 120,
      totalBars: 16,
      noteHeight: 20
    };
  }

  initKeysState() {
    const state = [];
    for (let y = 0; y < this.numberOfFrets; y++) {
      state[y] = [];
      for (let x = 0; x < this.numberOfStrings; x++) {
        state[y][x] = {
          marker: false,
          pressing: false,
          sequencerPlaying: false
        };
      }
    }
    return state;
  }

  updateModel(modelName) {
    this.currentModel = MODELS[modelName];
    this.numberOfStrings = this.currentModel.numberOfStrings;
    this.numberOfFrets = this.currentModel.numberOfFrets;
    this.BASE_NOTE = this.currentModel.startNote;
    this.BASE_OCTAVE = this.currentModel.startOctave;
    this.keysState = this.initKeysState();
  }

  getNoteName(x, y) {
    const baseNoteIndex = NOTES.indexOf(this.BASE_NOTE);
    const semitones = getSemitonesFromBase(x, y);
    const noteIndex = mod(baseNoteIndex + semitones, NOTES.length);
    return NOTES[noteIndex];
  }

  getNoteOctave(x, y) {
    const baseNoteIndex = NOTES.indexOf(this.BASE_NOTE);
    const semitones = getSemitonesFromBase(x, y);
    const totalSemitones = baseNoteIndex + semitones;
    const octaveShift = Math.floor(totalSemitones / NOTES.length);
    return this.BASE_OCTAVE + octaveShift;
  }

  setKeyState(x, y, type, value) {
    if (this.keysState[y] && this.keysState[y][x]) {
      this.keysState[y][x][type] = value;
    }
  }

  toggleMarker(x, y) {
    if (this.keysState[y] && this.keysState[y][x]) {
      this.keysState[y][x].marker = !this.keysState[y][x].marker;
    }
  }

  clearAllMarkers() {
    for (let y = 0; y < this.numberOfFrets; y++) {
      for (let x = 0; x < this.numberOfStrings; x++) {
        this.keysState[y][x].marker = false;
        this.keysState[y][x].pressing = false;
      }
    }
  }

  // Chord methods
  setChordRecordIndex(index) {
    this.chordRecordIndex = (this.chordRecordIndex === index) ? -1 : index;
  }

  addChordNote(x, y) {
    if (this.chordRecordIndex === -1) return;
    
    const noteName = this.getNoteName(x, y);
    const octave = this.getNoteOctave(x, y);
    const chord = this.chordSlots[this.chordRecordIndex];
    
    const existing = chord.keys.find(k => k.x === x && k.y === y);
    if (!existing) {
      chord.keys.push({ x, y, noteName, octave });
    }
  }

  clearChordNotes(index) {
    if (this.chordSlots[index]) {
      this.chordSlots[index].keys = [];
    }
  }

  renameChordSlot(index, newName) {
    if (this.chordSlots[index]) {
      this.chordSlots[index].name = newName;
    }
  }
}

export const appState = new AppState();
