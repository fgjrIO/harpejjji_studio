import { appState } from './state.js';
import { audioEngine } from './audio.js';

class ChordManager {
  constructor() {
    this.clearTabOnTrigger = false;
  }

  init() {
    // Initialize chord mode UI references
    this.chordModeSelect = document.getElementById("chordModeSelect");
    this.strumPaceInput = document.getElementById("strumPaceInput");
    this.strumPaceUnit = document.getElementById("strumPaceUnit");
    this.clearTabOnTriggerCheckbox = document.getElementById("clearTabOnTrigger");

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Setup chord record buttons
    document.querySelectorAll('.chord-record-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-chord-index'), 10);
        this.toggleChordRecord(idx);
      });
    });

    // Setup chord clear buttons
    document.querySelectorAll('.chord-clear-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-chord-index'), 10);
        this.clearChordNotes(idx);
      });
    });

    // Setup chord rename buttons
    document.querySelectorAll('.chord-rename-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-chord-index'), 10);
        this.renameChordSlot(idx);
      });
    });

    // Setup chord save buttons
    document.querySelectorAll('.chord-save-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-chord-index'), 10);
        this.saveChord(idx);
      });
    });

    // Setup chord buttons
    document.querySelectorAll('.chord-button').forEach(btn => {
      const slot = btn.closest('.chord-slot');
      const idx = parseInt(slot.getAttribute('data-chord-index'), 10);

      // Click handler
      btn.addEventListener('click', () => {
        if (this.clearTabOnTriggerCheckbox.checked) {
          this.clearAllTabMarkers();
        }
        if (this.chordModeSelect.value === 'press') {
          if (appState.keyMode === 'toggle') {
            this.chordToggle(idx);
          }
        } else if (this.chordModeSelect.value === 'strum') {
          this.chordStrum(idx);
        }
      });

      // Mouse events for press mode
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (this.chordModeSelect.value === 'press') {
          if (this.clearTabOnTriggerCheckbox.checked) {
            this.clearAllTabMarkers();
          }
          if (appState.keyMode === 'press') {
            this.chordPressDown(idx);
          }
        }
      });

      btn.addEventListener('mouseup', (e) => {
        e.preventDefault();
        if (this.chordModeSelect.value === 'press') {
          if (appState.keyMode === 'press') {
            this.chordPressUp(idx);
          }
        }
      });

      btn.addEventListener('mouseleave', (e) => {
        if (this.chordModeSelect.value === 'press') {
          if (appState.keyMode === 'press' && e.buttons === 1) {
            this.chordPressUp(idx);
          }
        }
      });
    });
  }

  toggleChordRecord(index) {
    appState.setChordRecordIndex(index);
    this.updateChordPaletteUI();
  }

  clearChordNotes(index) {
    appState.clearChordNotes(index);
    this.updateChordPaletteUI();
  }

  renameChordSlot(index) {
    const newName = prompt("Enter new name for this chord:", appState.chordSlots[index].name);
    if (newName) {
      appState.renameChordSlot(index, newName);
      this.updateChordPaletteUI();
    }
  }

  saveChord(index) {
    const chord = appState.chordSlots[index];
    if (chord.keys.length === 0) {
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

    // Save to localStorage
    const savedSelections = JSON.parse(localStorage.getItem('harpejjiSelections') || '[]');
    savedSelections.push(data);
    localStorage.setItem('harpejjiSelections', JSON.stringify(savedSelections));

    // Download file
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${chordName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  chordPressDown(chordIndex) {
    const chord = appState.chordSlots[chordIndex];
    chord.keys.forEach(keyData => {
      this.handleKeyDownProgrammatically(keyData.x, keyData.y);
    });
  }

  chordPressUp(chordIndex) {
    const chord = appState.chordSlots[chordIndex];
    chord.keys.forEach(keyData => {
      this.handleKeyUpProgrammatically(keyData.x, keyData.y);
    });
  }

  chordToggle(chordIndex) {
    const chord = appState.chordSlots[chordIndex];
    chord.keys.forEach(keyData => {
      this.handleKeyDownProgrammatically(keyData.x, keyData.y);
      setTimeout(() => {
        this.handleKeyUpProgrammatically(keyData.x, keyData.y);
      }, 300);
    });
  }

  chordStrum(chordIndex) {
    const chord = appState.chordSlots[chordIndex];
    // Sort left to right: ascending x, then y
    let sortedKeys = chord.keys.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));

    // Determine strum delay
    const strumPaceVal = parseFloat(this.strumPaceInput.value) || 100;
    let delayMs = strumPaceVal;
    if (this.strumPaceUnit.value === "beats") {
      delayMs = (60 / appState.SEQUENCER_CONFIG.bpm) * 1000 * strumPaceVal;
    }

    let i = 0;
    const pressNextKey = () => {
      if (i >= sortedKeys.length) return;
      const keyData = sortedKeys[i];
      this.handleKeyDownProgrammatically(keyData.x, keyData.y);
      setTimeout(() => {
        this.handleKeyUpProgrammatically(keyData.x, keyData.y);
      }, 300);
      i++;
      if (i < sortedKeys.length) {
        setTimeout(pressNextKey, delayMs);
      }
    };
    pressNextKey();
  }

  handleKeyDownProgrammatically(x, y) {
    const noteName = appState.getNoteName(x, y);
    const octave = appState.getNoteOctave(x, y);
    const oscObj = audioEngine.playNote(noteName, octave, appState.currentInstrument);
    appState.activeOscillators.set(`${x}_${y}`, oscObj);

    if (appState.keyMode === 'toggle') {
      appState.toggleMarker(x, y);
    } else if (appState.keyMode === 'press') {
      appState.setKeyState(x, y, 'pressing', true);
    }
  }

  handleKeyUpProgrammatically(x, y) {
    const keyStr = `${x}_${y}`;
    if (appState.activeOscillators.has(keyStr)) {
      audioEngine.stopNote(appState.activeOscillators.get(keyStr));
      appState.activeOscillators.delete(keyStr);
    }
    if (appState.keyMode === 'press') {
      appState.setKeyState(x, y, 'pressing', false);
    }
  }

  clearAllTabMarkers() {
    appState.clearAllMarkers();
  }

  updateChordPaletteUI() {
    const recordButtons = document.querySelectorAll('.chord-record-btn');
    recordButtons.forEach(btn => {
      const idx = parseInt(btn.getAttribute('data-chord-index'), 10);
      if (idx === appState.chordRecordIndex) {
        btn.classList.add('ring', 'ring-offset-2', 'ring-red-500');
      } else {
        btn.classList.remove('ring', 'ring-offset-2', 'ring-red-500');
      }
    });

    const chordButtons = document.querySelectorAll('.chord-button');
    chordButtons.forEach(btn => {
      const slot = btn.closest('.chord-slot');
      const idx = parseInt(slot.getAttribute('data-chord-index'), 10);
      btn.textContent = appState.chordSlots[idx].name;
    });
  }
}

export const chordManager = new ChordManager();
