// Some default built-in scales
// ==============================
let loadedScales = {
  "Major": [2, 2, 1, 2, 2, 2, 1],
  "Minor": [2, 1, 2, 2, 1, 2, 2],
  "Harmonic Major": [2, 2, 1, 2, 1, 3, 1],
};

// ==============================
// Configuration
// ==============================
const MODELS = {
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

// Each column => +2 semitones
// Each row => +1 semitone
function getSemitonesFromBase(x, y) {
  return (x * 2) + (y * 1);
}

// Global for fret spacing
let fretSpacing = 30;
const stringSpacing = 30;
const keyHeight = 25;

const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// NEW: Big chord dictionary
const CHORD_DEFINITIONS = [
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

// Current model defaults to K24
let currentModel = MODELS.K24;
let numberOfFrets = currentModel.numberOfFrets;
let numberOfStrings = currentModel.numberOfStrings;
let BASE_NOTE = currentModel.startNote;
let BASE_OCTAVE = currentModel.startOctave;

// We keep an array for each fret/string
let keysState = [];
function initKeysState() {
  keysState = [];
  for (let y = 0; y < numberOfFrets; y++) {
    keysState[y] = [];
    for (let x = 0; x < numberOfStrings; x++) {
      keysState[y][x] = {
        marker: false,
        pressing: false,
        sequencerPlaying: false,
        finger: null,
        // For fading:
        fading: false,
        fadeOutStart: null
      };
    }
  }
}
initKeysState();

// show/hide note names
let showNotes = false;

// A basic map for wave creation
const instrumentMap = {
  piano: "sine",
  guitar: "triangle",
  ukulele: "square",
  harp: "sawtooth"
};
let currentInstrument = "piano";

// Audio
let audioContext;
let masterGainNode;
let delayNode;
let delayGain;
let reverbConvolver;
let reverbGain;

// user-played oscillators
let activeUserOscillators = new Map();
let allLiveOscillators = new Set();

// Scale Mode
let currentScale = "none";
let currentRoot = "A";
let scaleHighlightColor = "#ffc107";
let scaleHighlightAlpha = 0.3;
let scaleHighlightMode = "fill";

// NEW: Finger overlay color
let fingerOverlayColor = "#000000";

// NEW: Fade config
let fadeNotes = false;
let fadeTime = 1.0;
let fadeAnimationActive = false;

/**
 * Generate a set of pitch classes (0..11) for the selected scale,
 * relative to the chosen root.
 */
function getScaleSemitones(scaleName, rootNote) {
  if (!scaleName || scaleName === "none") return new Set();
  if (!loadedScales[scaleName]) return new Set();

  const intervals = loadedScales[scaleName];
  const rootIndex = NOTES.indexOf(rootNote);
  if (rootIndex === -1) return new Set();

  let semitonesSet = new Set();
  let currentPos = 0;
  semitonesSet.add(rootIndex % 12);
  intervals.forEach(interval => {
    currentPos += interval;
    semitonesSet.add((rootIndex + currentPos) % 12);
  });
  return semitonesSet;
}

function initAudio() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  masterGainNode = audioContext.createGain();
  masterGainNode.gain.value = 0.1;

  delayNode = audioContext.createDelay(5.0);
  delayGain = audioContext.createGain();
  delayGain.gain.value = 0;
  delayNode.connect(delayGain);
  delayGain.connect(masterGainNode);

  // Convolver for reverb
  reverbConvolver = audioContext.createConvolver();
  const length = audioContext.sampleRate * 1.0;
  const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
  for (let c = 0; c < 2; c++) {
    let channel = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      channel[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
  }
  reverbConvolver.buffer = impulse;

  reverbGain = audioContext.createGain();
  reverbGain.gain.value = 0;
  reverbConvolver.connect(reverbGain);
  reverbGain.connect(masterGainNode);

  masterGainNode.connect(audioContext.destination);
}

/**
 * Create a more sophisticated multi-node chain to approximate
 * some realism for each instrument (ADSR, filter).
 */
function createInstrumentSound(frequency, instrument) {
  if (!audioContext) initAudio();

  // Create a master gain for the note
  const noteGain = audioContext.createGain();
  noteGain.gain.value = 0; // will envelope in

  // A filter for timbre shaping
  const filter = audioContext.createBiquadFilter();
  filter.type = "lowpass";

  // Envelope parameters per instrument
  let envelope = { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.5 };
  let filterFreq = 2000;

  switch(instrument) {
    case 'piano':
      envelope = { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.8 };
      filterFreq = 3000;
      break;
    case 'guitar':
      envelope = { attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.6 };
      filterFreq = 2500;
      break;
    case 'ukulele':
      envelope = { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.5 };
      filterFreq = 3500;
      break;
    case 'harp':
      envelope = { attack: 0.02, decay: 0.2, sustain: 0.3, release: 1.0 };
      filterFreq = 4000;
      break;
    default:
      envelope = { attack: 0.01, decay: 0.2, sustain: 0.2, release: 0.5 };
      filterFreq = 2000;
      break;
  }

  // Two detuned oscillators
  const osc1 = audioContext.createOscillator();
  const osc2 = audioContext.createOscillator();
  const waveType = instrumentMap[instrument] || "sine";
  osc1.type = waveType;
  osc2.type = waveType;
  osc1.frequency.value = frequency;
  osc2.frequency.value = frequency * 1.003; // slight detune

  // Connect them to the filter
  osc1.connect(filter);
  osc2.connect(filter);

  // Filter -> noteGain
  filter.connect(noteGain);

  // Connect noteGain to the main chain
  noteGain.connect(masterGainNode);
  noteGain.connect(delayNode);
  noteGain.connect(reverbConvolver);

  filter.frequency.value = filterFreq;

  // ADSR envelope
  const now = audioContext.currentTime;
  const attackEnd = now + envelope.attack;
  const decayEnd = attackEnd + envelope.decay;

  noteGain.gain.cancelScheduledValues(now);
  noteGain.gain.setValueAtTime(0, now);
  noteGain.gain.linearRampToValueAtTime(1.0, attackEnd);
  noteGain.gain.linearRampToValueAtTime(envelope.sustain, decayEnd);

  osc1.start(now);
  osc2.start(now);

  return {
    stop: () => {
      const releaseStart = audioContext.currentTime;
      const releaseEnd = releaseStart + envelope.release;
      noteGain.gain.cancelScheduledValues(releaseStart);
      noteGain.gain.setValueAtTime(noteGain.gain.value, releaseStart);
      noteGain.gain.linearRampToValueAtTime(0.0001, releaseEnd);
      setTimeout(() => {
        osc1.stop();
        osc2.stop();
        osc1.disconnect();
        osc2.disconnect();
        filter.disconnect();
        noteGain.disconnect();
      }, envelope.release * 1000 + 50);
    }
  };
}

function createOscillator(frequency, instrument) {
  const soundObj = createInstrumentSound(frequency, instrument);
  const fakeOscObj = {
    osc: { stop: soundObj.stop },
    gain: { disconnect: () => {} }
  };
  allLiveOscillators.add(fakeOscObj);
  return fakeOscObj;
}

function stopOscillator(oscObj) {
  if (!oscObj) return;
  if (oscObj.osc && typeof oscObj.osc.stop === 'function') {
    oscObj.osc.stop();
  }
  allLiveOscillators.delete(oscObj);
}

/**
 * Thorough approach to kill any possible hung notes
 */
function killAllNotes() {
  // Stop all possible oscillators
  for (let obj of allLiveOscillators) {
    if (obj && obj.osc && typeof obj.osc.stop === 'function') {
      obj.osc.stop();
    }
  }
  allLiveOscillators.clear();

  // Clear active user oscillators map
  activeUserOscillators.clear();

  // Also stop any sequencer notes
  recordedNotes.forEach(note => {
    if (note.isPlaying && note.oscObj) {
      stopOscillator(note.oscObj);
      note.oscObj = null;
      note.isPlaying = false;
      keysState[note.y][note.x].sequencerPlaying = false;
    }
  });

  // Forcefully reset pressing flags so that no chord/hung note remains flagged
  for (let y = 0; y < numberOfFrets; y++) {
    for (let x = 0; x < numberOfStrings; x++) {
      keysState[y][x].pressing = false;
      keysState[y][x].fading = false;
      keysState[y][x].fadeOutStart = null;
    }
  }

  drawTablature();
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

function noteToFrequency(noteName, octave) {
  const noteIndex = NOTES.indexOf(noteName);
  if (noteIndex === -1) return 440;
  const A4_OCTAVE = 4;
  const A4_INDEX = NOTES.indexOf("A");
  const semitones = (octave - A4_OCTAVE) * 12 + (noteIndex - A4_INDEX);
  return 440 * Math.pow(2, semitones / 12);
}

function getNoteName(x, y) {
  const baseNoteIndex = NOTES.indexOf(BASE_NOTE);
  const semitones = getSemitonesFromBase(x, y);
  const noteIndex = mod(baseNoteIndex + semitones, NOTES.length);
  return NOTES[noteIndex];
}

function getNoteOctave(x, y) {
  const baseNoteIndex = NOTES.indexOf(BASE_NOTE);
  const semitones = getSemitonesFromBase(x, y);
  const totalSemitones = baseNoteIndex + semitones;
  const octaveShift = Math.floor(totalSemitones / NOTES.length);
  return BASE_OCTAVE + octaveShift;
}

function isBlackNote(noteName) {
  return noteName.includes("#");
}

// ==============================
// Draw Tablature
// ==============================
function drawTablature() {
  const totalWidth = (numberOfStrings * stringSpacing) + stringSpacing + 10;
  const totalHeight = (numberOfFrets * fretSpacing) + keyHeight + fretSpacing/2 + 10;
  const svg = document.getElementById("tablature");
  svg.setAttribute("width", totalWidth);
  svg.setAttribute("height", totalHeight);
  svg.innerHTML = "";

  const bg = document.createElementNS("http://www.w3.org/2000/svg","rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "white");
  svg.appendChild(bg);

  const g = document.createElementNS("http://www.w3.org/2000/svg","g");
  svg.appendChild(g);

  // Horizontal fret lines
  for (let row = 0; row <= numberOfFrets; row++) {
    const lineY = row * fretSpacing + fretSpacing/2;
    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", 0);
    line.setAttribute("y1", totalHeight - lineY);
    line.setAttribute("x2", numberOfStrings * stringSpacing);
    line.setAttribute("y2", totalHeight - lineY);
    line.setAttribute("stroke", "#000");
    line.setAttribute("stroke-width", "1");
    g.appendChild(line);
  }

  // Vertical string lines
  for (let x = 0; x < numberOfStrings; x++) {
    const lineX = x * stringSpacing + stringSpacing;
    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", lineX);
    line.setAttribute("y1", (totalHeight - fretSpacing/2 - keyHeight));
    line.setAttribute("x2", lineX);
    line.setAttribute("y2", fretSpacing/2);
    line.setAttribute("stroke", "#CCC");
    line.setAttribute("stroke-width", "1");
    g.appendChild(line);
  }

  // Outer border
  const borderRect = document.createElementNS("http://www.w3.org/2000/svg","rect");
  borderRect.setAttribute("x", 0.5);
  borderRect.setAttribute("y", 0.5);
  borderRect.setAttribute("width", totalWidth - 1);
  borderRect.setAttribute("height", totalHeight - 1);
  borderRect.setAttribute("fill", "transparent");
  borderRect.setAttribute("stroke", "black");
  borderRect.setAttribute("stroke-width", "1");
  g.appendChild(borderRect);

  // Scale highlighting
  const scaleSet = getScaleSemitones(currentScale, currentRoot);

  let stillFading = false;
  const now = performance.now();

  // Draw keys
  for (let y = 0; y < numberOfFrets; y++) {
    for (let x = 0; x < numberOfStrings; x++) {
      const noteName = getNoteName(x, y);
      const octave = getNoteOctave(x, y);
      const blackKey = isBlackNote(noteName);

      const noteIndex = NOTES.indexOf(noteName);
      const inScale = scaleSet.has(noteIndex);

      const yPos = totalHeight - ((y * fretSpacing) + fretSpacing/2) - keyHeight;
      const xPos = (x * stringSpacing) + stringSpacing - 7.5;
      const keyGroup = document.createElementNS("http://www.w3.org/2000/svg","g");
      keyGroup.setAttribute("transform", `translate(${xPos}, ${yPos})`);

      const rect = document.createElementNS("http://www.w3.org/2000/svg","rect");
      rect.setAttribute("x", 0);
      rect.setAttribute("y", 0);
      rect.setAttribute("width", 15);
      rect.setAttribute("height", keyHeight);
      rect.setAttribute("stroke", "#666");
      rect.setAttribute("stroke-width", "1");
      rect.setAttribute("fill", blackKey ? "#999" : "#FFF");

      keyGroup.appendChild(rect);

      if (inScale) {
        // Depending on mode, either fill, outline, or both
        if (scaleHighlightMode === "fill" || scaleHighlightMode === "both") {
          const highlightRect = document.createElementNS("http://www.w3.org/2000/svg","rect");
          highlightRect.setAttribute("x", 0);
          highlightRect.setAttribute("y", 0);
          highlightRect.setAttribute("width", 15);
          highlightRect.setAttribute("height", keyHeight);
          highlightRect.setAttribute("fill", scaleHighlightColor);
          highlightRect.setAttribute("fill-opacity", scaleHighlightAlpha.toString());
          keyGroup.appendChild(highlightRect);
        }
        if (scaleHighlightMode === "outline" || scaleHighlightMode === "both") {
          const outlineRect = document.createElementNS("http://www.w3.org/2000/svg","rect");
          outlineRect.setAttribute("x", 0);
          outlineRect.setAttribute("y", 0);
          outlineRect.setAttribute("width", 15);
          outlineRect.setAttribute("height", keyHeight);
          outlineRect.setAttribute("fill", "none");
          outlineRect.setAttribute("stroke", scaleHighlightColor);
          outlineRect.setAttribute("stroke-opacity", scaleHighlightAlpha.toString());
          outlineRect.setAttribute("stroke-width", "2");
          keyGroup.appendChild(outlineRect);
        }
      }

      // Always display small rectangle outline for C
      if (noteName === "C") {
        const cIndicatorRect = document.createElementNS("http://www.w3.org/2000/svg","rect");
        cIndicatorRect.setAttribute("x", 4);
        cIndicatorRect.setAttribute("y", 18);
        cIndicatorRect.setAttribute("width", 7);
        cIndicatorRect.setAttribute("height", 3);
        cIndicatorRect.setAttribute("fill", "none");
        cIndicatorRect.setAttribute("stroke", "black");
        cIndicatorRect.setAttribute("stroke-width", "1");
        keyGroup.appendChild(cIndicatorRect);
      }

      const stateObj = keysState[y][x];
      let drawCircle = false;
      let circleAlpha = 1.0;

      if (stateObj.marker || stateObj.pressing || stateObj.sequencerPlaying) {
        drawCircle = true;
      } else if (stateObj.fading) {
        // Compute fade alpha
        const elapsed = (now - stateObj.fadeOutStart) / 1000;
        const ratio = 1 - (elapsed / fadeTime);
        if (ratio > 0) {
          drawCircle = true;
          circleAlpha = ratio;
          stillFading = true;
        } else {
          // Fade ended
          stateObj.fading = false;
          stateObj.fadeOutStart = null;
        }
      }

      if (drawCircle) {
        const circ = document.createElementNS("http://www.w3.org/2000/svg","circle");
        circ.setAttribute("cx", 7.5);
        circ.setAttribute("cy", 12.5);
        circ.setAttribute("r", 7);
        circ.setAttribute("fill", `rgba(0, 153, 255, ${circleAlpha})`);
        keyGroup.appendChild(circ);

        // If finger assigned, overlay text
        if (stateObj.finger && circleAlpha > 0.2) {
          const fingerText = document.createElementNS("http://www.w3.org/2000/svg","text");
          fingerText.setAttribute("x", 7.5);
          fingerText.setAttribute("y", 13);
          fingerText.setAttribute("fill", fingerOverlayColor);
          fingerText.setAttribute("font-size", "8");
          fingerText.setAttribute("font-family", "Helvetica, Arial, sans-serif");
          fingerText.setAttribute("text-anchor", "middle");
          fingerText.setAttribute("dominant-baseline","middle");
          fingerText.textContent = stateObj.finger;
          keyGroup.appendChild(fingerText);
        }
      }

      if (showNotes) {
        const label = document.createElementNS("http://www.w3.org/2000/svg","text");
        label.setAttribute("x", 7.5);
        label.setAttribute("y", 7);
        label.setAttribute("fill", blackKey ? "#EEE" : "#555");
        label.setAttribute("font-size", "7");
        label.setAttribute("font-family", "Helvetica, Arial, sans-serif");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline","middle");
        label.textContent = noteName + octave;
        keyGroup.appendChild(label);
      }

      keyGroup.style.cursor = "pointer";
      keyGroup.addEventListener("mousedown", () => handleKeyDown(x, y));
      keyGroup.addEventListener("mouseup", () => handleKeyUp(x, y));

      // If in select mode for pitch mapping:
      keyGroup.addEventListener("click", () => {
        if (awaitingMappingPitch !== null) {
          if (pitchPossiblePositions[awaitingMappingPitch]) {
            const found = pitchPossiblePositions[awaitingMappingPitch]
              .find(pos => pos.x === x && pos.y === y);
            if (found) {
              pitchMappings[awaitingMappingPitch] = { x, y };
              // Clear highlight
              pitchPossiblePositions[awaitingMappingPitch].forEach(pos => {
                keysState[pos.y][pos.x].marker = false;
              });
              drawTablature();
              awaitingMappingPitch = null;
            }
          }
        }
      });

      g.appendChild(keyGroup);
    }
  }

  if (stillFading) {
    if (!fadeAnimationActive) {
      fadeAnimationActive = true;
    }
    requestAnimationFrame(drawTablature);
  } else {
    fadeAnimationActive = false;
  }
}

let keyMode = 'toggle';

// ==============================
// CHORD PALETTE
// ==============================
let chordSlots = Array(8).fill(null).map((_, i) => ({
  name: `Chord ${i+1}`,
  keys: []
}));
let chordRecordIndex = -1;

function toggleChordRecord(index) {
  chordRecordIndex = (chordRecordIndex === index) ? -1 : index;
  updateChordPaletteUI();
}

function clearChordNotes(index) {
  chordSlots[index].keys = [];
  updateChordPaletteUI();
}

function renameChordSlot(index) {
  const newName = prompt("Enter new name for this chord:", chordSlots[index].name);
  if (newName) {
    chordSlots[index].name = newName;
    updateChordPaletteUI();
  }
}

function recordChordNoteIfNeeded(x, y) {
  if (chordRecordIndex === -1) return;
  const noteName = getNoteName(x, y);
  const octave = getNoteOctave(x, y);

  const chord = chordSlots[chordRecordIndex];
  const existing = chord.keys.find(k => k.x === x && k.y === y);
  if (!existing) {
    chord.keys.push({ x, y, noteName, octave });
  }
}

function setChordNotesFromKeysState(index) {
  const chord = chordSlots[index];
  chord.keys = [];
  for (let y = 0; y < numberOfFrets; y++) {
    for (let x = 0; x < numberOfStrings; x++) {
      if (keysState[y][x].marker) {
        chord.keys.push({
          x,
          y,
          noteName: getNoteName(x, y),
          octave: getNoteOctave(x, y)
        });
      }
    }
  }
  updateChordPaletteUI();
}

// Existing chord logic
function chordPressDown(chordIndex) {
  const chord = chordSlots[chordIndex];
  chord.keys.forEach(keyData => {
    handleKeyDownProgrammatically(keyData.x, keyData.y);
  });
}
function chordPressUp(chordIndex) {
  const chord = chordSlots[chordIndex];
  chord.keys.forEach(keyData => {
    handleKeyUpProgrammatically(keyData.x, keyData.y);
  });
}
function chordToggle(chordIndex) {
  const chord = chordSlots[chordIndex];
  chord.keys.forEach(keyData => {
    handleKeyDownProgrammatically(keyData.x, keyData.y);
    setTimeout(() => {
      handleKeyUpProgrammatically(keyData.x, keyData.y);
    }, 300);
  });
}

// NEW: strum logic
function chordStrum(chordIndex) {
  const chord = chordSlots[chordIndex];
  // Sort left to right: ascending x, then y
  let sortedKeys = chord.keys.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));

  // Determine strum delay
  const strumPaceVal = parseFloat(strumPaceInput.value) || 100;
  let delayMs = strumPaceVal;
  if (strumPaceUnit.value === "beats") {
    // convert beats to ms using current BPM
    delayMs = (60 / SEQUENCER_CONFIG.bpm) * 1000 * strumPaceVal;
  }

  let i = 0;
  function pressNextKey() {
    if (i >= sortedKeys.length) return;
    const keyData = sortedKeys[i];
    handleKeyDownProgrammatically(keyData.x, keyData.y);
    setTimeout(() => {
      handleKeyUpProgrammatically(keyData.x, keyData.y);
    }, 300);
    i++;
    if (i < sortedKeys.length) {
      setTimeout(pressNextKey, delayMs);
    }
  }
  pressNextKey();
}

// Utility to clear all markers before chord trigger
function clearAllTabMarkers() {
  for (let y = 0; y < numberOfFrets; y++) {
    for (let x = 0; x < numberOfStrings; x++) {
      keysState[y][x].marker = false;
      keysState[y][x].pressing = false;
      keysState[y][x].finger = null;
      keysState[y][x].fading = false;
      keysState[y][x].fadeOutStart = null;
    }
  }
  drawTablature();
}

function updateChordPaletteUI() {
  const recordButtons = document.querySelectorAll('.chord-record-btn');
  recordButtons.forEach(btn => {
    const idx = parseInt(btn.getAttribute('data-chord-index'), 10);
    if (idx === chordRecordIndex) {
      btn.classList.add('ring');
      btn.classList.add('ring-offset-2');
      btn.classList.add('ring-red-500');
    } else {
      btn.classList.remove('ring');
      btn.classList.remove('ring-offset-2');
      btn.classList.remove('ring-red-500');
    }
  });

  const chordButtons = document.querySelectorAll('.chord-button');
  chordButtons.forEach(btn => {
    const slot = btn.closest('.chord-slot');
    const idx = parseInt(slot.getAttribute('data-chord-index'), 10);
    btn.textContent = chordSlots[idx].name;
  });
}

// ==============================
// Key Handling
// ==============================
function handleKeyDownProgrammatically(x, y) {
  const noteName = getNoteName(x, y);
  const octave = getNoteOctave(x, y);
  const freq = noteToFrequency(noteName, octave);

  const oscObj = createOscillator(freq, currentInstrument);
  activeUserOscillators.set(`${x}_${y}`, oscObj);

  if (keyMode === 'toggle') {
    const oldState = keysState[y][x].marker;
    keysState[y][x].marker = !oldState;
    if (keysState[y][x].marker) {
      // Assign finger if dropdown != None
      const selectedFinger = document.getElementById("fingerSelect").value;
      if (selectedFinger !== "None") {
        keysState[y][x].finger = selectedFinger;
      } else {
        keysState[y][x].finger = null;
      }
    } else {
      // turned off marker, remove finger
      keysState[y][x].finger = null;
    }
  } else if (keyMode === 'press') {
    // Stop any fade in progress
    keysState[y][x].fading = false;
    keysState[y][x].fadeOutStart = null;
    keysState[y][x].pressing = true;
  }
  startNoteRecording(x, y);
  drawTablature();
}

function handleKeyUpProgrammatically(x, y) {
  const keyStr = `${x}_${y}`;
  if (activeUserOscillators.has(keyStr)) {
    stopOscillator(activeUserOscillators.get(keyStr));
    activeUserOscillators.delete(keyStr);
  }
  if (keyMode === 'press') {
    if (fadeNotes) {
      // Begin fading
      keysState[y][x].pressing = false;
      keysState[y][x].fading = true;
      keysState[y][x].fadeOutStart = performance.now();
    } else {
      keysState[y][x].pressing = false;
    }
  }
  stopNoteRecording(x, y);
  drawTablature();
}

function handleKeyDown(x, y) {
  const noteName = getNoteName(x, y);
  const octave = getNoteOctave(x, y);
  const freq = noteToFrequency(noteName, octave);

  const oscObj = createOscillator(freq, currentInstrument);
  activeUserOscillators.set(`${x}_${y}`, oscObj);

  if (keyMode === 'toggle') {
    const oldState = keysState[y][x].marker;
    keysState[y][x].marker = !oldState;
    if (keysState[y][x].marker) {
      // Assign finger if dropdown != None
      const selectedFinger = document.getElementById("fingerSelect").value;
      if (selectedFinger !== "None") {
        keysState[y][x].finger = selectedFinger;
      } else {
        keysState[y][x].finger = null;
      }
    } else {
      keysState[y][x].finger = null;
    }
  } else if (keyMode === 'press') {
    // Stop any fade in progress
    keysState[y][x].fading = false;
    keysState[y][x].fadeOutStart = null;
    keysState[y][x].pressing = true;
  }

  recordChordNoteIfNeeded(x, y);
  startNoteRecording(x, y);
  drawTablature();
}

function handleKeyUp(x, y) {
  const keyStr = `${x}_${y}`;
  if (activeUserOscillators.has(keyStr)) {
    stopOscillator(activeUserOscillators.get(keyStr));
    activeUserOscillators.delete(keyStr);
  }
  if (keyMode === 'press') {
    if (fadeNotes) {
      // Begin fading
      keysState[y][x].pressing = false;
      keysState[y][x].fading = true;
      keysState[y][x].fadeOutStart = performance.now();
    } else {
      keysState[y][x].pressing = false;
    }
  }
  stopNoteRecording(x, y);
  drawTablature();
}

// ==============================
// Save/Load Tablature
// ==============================
function saveSelection() {
  const fileName = prompt("Enter a name for your tab:", "My Tab");
  if (!fileName) return;

  const plainTextNotes = [];
  for (let y = 0; y < numberOfFrets; y++) {
    for (let x = 0; x < numberOfStrings; x++) {
      if (keysState[y][x].marker) {
        const noteName = getNoteName(x, y);
        const octave = getNoteOctave(x, y);
        plainTextNotes.push(`${noteName}${octave}`);
      }
    }
  }
  const now = new Date();
  const dateStr = now.toLocaleDateString();
  const timeStr = now.toLocaleTimeString();

  const svg = document.getElementById("tablature");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const svgData = new XMLSerializer().serializeToString(svg);
  const img = new Image();

  img.onload = function() {
    canvas.width = svg.width.baseVal.value;
    canvas.height = svg.height.baseVal.value;
    ctx.drawImage(img, 0, 0);
    
    const data = {
      type: "tab",
      name: fileName,
      date: dateStr,
      time: timeStr,
      model: modelSelect.value,
      keysState: keysState,
      image: canvas.toDataURL("image/png"),
      timestamp: new Date().toISOString(),
      modelData: {
        numberOfStrings: currentModel.numberOfStrings,
        numberOfFrets: currentModel.numberOfFrets,
        startNote: currentModel.startNote,
        startOctave: currentModel.startOctave,
        endNote: currentModel.endNote,
        endOctave: currentModel.endOctave
      },
      notesPlainText: plainTextNotes
    };

    const savedSelections = JSON.parse(localStorage.getItem('harpejjiSelections') || '[]');
    savedSelections.push(data);
    localStorage.setItem('harpejjiSelections', JSON.stringify(savedSelections));

    // Also download
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.json`;
    a.click();
    URL.revokeObjectURL(url);

    populateLibrary();
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
}

/**
 * Save chord to file (does NOT add to library)
 */
function saveChordToFile(index) {
  const chord = chordSlots[index];
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

  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${chordName}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Helper to capture a partial chord image with 1 fret margin (up/down).
 */
function captureChordImage(chord) {
  if (!chord || chord.keys.length === 0) return null;

  let minY = Math.min(...chord.keys.map(k => k.y));
  let maxY = Math.max(...chord.keys.map(k => k.y));

  minY = Math.max(0, minY - 1);
  maxY = Math.min(numberOfFrets - 1, maxY + 1);

  let minX = Math.min(...chord.keys.map(k => k.x));
  let maxX = Math.max(...chord.keys.map(k => k.x));

  const totalWidth = (numberOfStrings * stringSpacing) + stringSpacing + 10;
  const totalHeight = (numberOfFrets * fretSpacing) + keyHeight + fretSpacing/2 + 10;

  const svg = document.getElementById("tablature");
  const svgData = new XMLSerializer().serializeToString(svg);
  const img = new Image();

  return new Promise(resolve => {
    img.onload = () => {
      const fullCanvas = document.createElement("canvas");
      fullCanvas.width = svg.width.baseVal.value;
      fullCanvas.height = svg.height.baseVal.value;
      const fullCtx = fullCanvas.getContext("2d");
      fullCtx.drawImage(img, 0, 0);

      const yTop = totalHeight - ((maxY * fretSpacing) + fretSpacing/2) - keyHeight;
      const yBottom = totalHeight - ((minY * fretSpacing) + fretSpacing/2);
      const chordHeight = yBottom - yTop;

      const xLeft = (minX * stringSpacing) + stringSpacing - 7.5;
      const xRight = (maxX * stringSpacing) + stringSpacing + 7.5;
      const chordWidth = xRight - xLeft;

      const chordCanvas = document.createElement("canvas");
      chordCanvas.width = chordWidth;
      chordCanvas.height = chordHeight;
      const chordCtx = chordCanvas.getContext("2d");
      chordCtx.drawImage(
        fullCanvas,
        xLeft, yTop,
        chordWidth, chordHeight,
        0, 0,
        chordWidth, chordHeight
      );

      resolve(chordCanvas.toDataURL("image/png"));
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  });
}

/**
 * Sends chord to the library with a bounding-box image and the current model.
 */
async function sendChordToLibrary(index) {
  const chord = chordSlots[index];
  if (chord.keys.length === 0) {
    alert("Cannot send an empty chord to library.");
    return;
  }
  const chordName = prompt("Enter a name for this chord:", chord.name);
  if (!chordName) return;

  chordSlots[index].name = chordName;

  const chordImage = await captureChordImage(chord);
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
    model: modelSelect.value,
    image: chordImage || null
  };

  const savedSelections = JSON.parse(localStorage.getItem('harpejjiSelections') || '[]');
  savedSelections.push(data);
  localStorage.setItem('harpejjiSelections', JSON.stringify(savedSelections));

  populateLibrary();
}

function loadSelection(data) {
  if (data.type === "tab") {
    modelSelect.value = data.model;
    if (data.modelData) {
      currentModel = data.modelData;
    } else {
      currentModel = MODELS[data.model];
    }
    numberOfStrings = currentModel.numberOfStrings;
    numberOfFrets = currentModel.numberOfFrets;
    BASE_NOTE = currentModel.startNote;
    BASE_OCTAVE = currentModel.startOctave;

    keysState = data.keysState;
    drawTablature();
    drawPianoRoll();
    drawSequencerGrid();

    if (chordRecordIndex !== -1) {
      setChordNotesFromKeysState(chordRecordIndex);
    }
  } else if (data.type === "chord") {
    // Only triggered if user clicks a chord from the library
    const userSlot = parseInt(prompt("Which chord slot do you want to load this chord into? (1-8)"), 10);
    if (isNaN(userSlot) || userSlot < 1 || userSlot > 8) {
      alert("Invalid chord slot index.");
      return;
    }
    const targetIndex = userSlot - 1;

    chordSlots[targetIndex].name = data.name;
    chordSlots[targetIndex].keys = data.keys.map(k => ({
      x: k.x,
      y: k.y,
      noteName: k.noteName,
      octave: k.octave
    }));
    updateChordPaletteUI();
  }
  toggleLibrary();
}

function handleFileLoad() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = JSON.parse(e.target.result);
        loadSelection(data);
      };
      reader.readAsText(file);
    }
  };
  input.click();
}

// ==============================
// Library
// ==============================
function toggleLibrary() {
  const slideover = document.getElementById("librarySlideover");
  slideover.classList.toggle("hidden");
}

function populateLibrary() {
  const libraryContent = document.getElementById("libraryContent");
  libraryContent.innerHTML = "";

  const savedSelections = JSON.parse(localStorage.getItem('harpejjiSelections') || '[]');

  if (savedSelections.length === 0) {
    libraryContent.innerHTML = '<p class="text-gray-500 text-center">No saved selections yet</p>';
    return;
  }

  const scaleFilterCheckbox = document.getElementById("scaleFilterCheckbox");
  const filterActive = scaleFilterCheckbox && scaleFilterCheckbox.checked && currentScale !== 'none';

  const libraryFilter = document.querySelector('input[name="libraryFilter"]:checked').value;
  const modelFilterSelect = document.getElementById("modelFilterSelect");
  const modelFilter = modelFilterSelect ? modelFilterSelect.value : "all";

  for (let index = 0; index < savedSelections.length; index++) {
    const selection = savedSelections[index];

    // Type filter
    if (libraryFilter !== "all" && selection.type !== libraryFilter.slice(0, -1)) {
      continue;
    }

    // Scale filter if active and selection is a tab
    if (filterActive && selection.type === "tab") {
      if (!allNotesInCurrentScale(selection.notesPlainText)) {
        continue;
      }
    }

    // Model filter
    if (modelFilter !== "all") {
      if (!selection.model || selection.model !== modelFilter) {
        continue;
      }
    }

    const div = document.createElement("div");
    div.className = "relative p-2 border rounded hover:bg-gray-100";
    if (selection.type === "tab") {
      div.innerHTML = `
        <button class="absolute top-2 right-2 px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 text-xs delete-btn">
          Delete
        </button>
        <div class="cursor-pointer selection-content">
          <img src="${selection.image}" alt="${selection.name}" class="w-full h-32 object-contain mb-2 bg-white">
          <div class="text-sm">
            <span class="block text-center font-bold">${selection.name}</span>
            <span class="block text-center text-gray-500">${selection.model}</span>
          </div>
        </div>
      `;
      if (selection.notesPlainText && selection.notesPlainText.length) {
        const textDiv = document.createElement("div");
        textDiv.className = "text-xs whitespace-pre-wrap mt-1";
        textDiv.innerHTML = selection.notesPlainText.join("\n");
        div.querySelector('.selection-content').appendChild(textDiv);
      }
      if (selection.date || selection.time) {
        const infoDiv = document.createElement("div");
        infoDiv.className = "block text-center text-gray-400 text-xs";
        infoDiv.textContent = (selection.date || "") + " " + (selection.time || "");
        div.querySelector('.selection-content').appendChild(infoDiv);
      }
      div.querySelector('.selection-content').addEventListener('click', () => loadSelection(selection));
    } else if (selection.type === "chord") {
      div.innerHTML = `
        <button class="absolute top-2 right-2 px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 text-xs delete-btn">
          Delete
        </button>
        <div class="cursor-pointer selection-content">
          ${
            selection.image 
              ? `<img src="${selection.image}" alt="${selection.name}" class="w-full h-32 object-contain mb-2 bg-white">`
              : ""
          }
          <div class="text-sm">
            <span class="block text-center font-bold">${selection.name}</span>
            <span class="block text-center text-gray-500">Chord</span>
            ${
              selection.model 
                ? `<span class="block text-center text-gray-500">${selection.model}</span>` 
                : ""
            }
          </div>
        </div>
      `;
      const chordKeysDiv = document.createElement("div");
      chordKeysDiv.className = "text-xs mt-1";
      chordKeysDiv.innerHTML = selection.keys
        .map(k => `${k.noteName}${k.octave} (row=${k.y}, string=${k.x})`)
        .join("<br>");
      div.querySelector('.selection-content').appendChild(chordKeysDiv);

      div.querySelector('.selection-content').addEventListener('click', () => loadSelection(selection));
    }

    div.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSelection(index);
    });
    libraryContent.appendChild(div);
  }
}

function deleteSelection(index) {
  if (!confirm('Are you sure you want to delete this selection?')) return;
  const savedSelections = JSON.parse(localStorage.getItem('harpejjiSelections') || '[]');
  savedSelections.splice(index, 1);
  localStorage.setItem('harpejjiSelections', JSON.stringify(savedSelections));
  populateLibrary();
}

function importFiles() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.multiple = true;
  input.onchange = (event) => {
    const files = event.target.files;
    if (files.length === 0) return;
    const savedSelections = JSON.parse(localStorage.getItem('harpejjiSelections') || '[]');
    let processed = 0;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.type === "tab" || data.type === "chord") {
            savedSelections.push(data);
          } else if (Array.isArray(data)) {
            data.forEach(d => {
              if (d.type === "tab" || d.type === "chord") {
                savedSelections.push(d);
              }
            });
          }
        } catch (error) {
          console.error('Error importing file:', error);
        }
        processed++;
        if (processed === files.length) {
          localStorage.setItem('harpejjiSelections', JSON.stringify(savedSelections));
          populateLibrary();
        }
      };
      reader.readAsText(file);
    });
  };
  input.click();
}

function saveLibrary() {
  const savedSelections = JSON.parse(localStorage.getItem('harpejjiSelections') || '[]');
  if (savedSelections.length === 0) {
    alert('No selections to save');
    return;
  }
  const completeLibrary = savedSelections.map(selection => {
    if (!selection.modelData && selection.type === "tab") {
      const model = MODELS[selection.model];
      selection.modelData = {
        numberOfStrings: model.numberOfStrings,
        numberOfFrets: model.numberOfFrets,
        startNote: model.startNote,
        startOctave: model.startOctave,
        endNote: model.endNote,
        endOctave: model.endOctave
      };
    }
    return selection;
  });

  const blob = new Blob([JSON.stringify(completeLibrary)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'harpejji_library.json';
  a.click();
  URL.revokeObjectURL(url);
}

function saveLibraryAs() {
  const fileName = prompt("Enter file name for library:", "harpejji_library");
  if (!fileName) return;

  const savedSelections = JSON.parse(localStorage.getItem('harpejjiSelections') || '[]');
  if (savedSelections.length === 0) {
    alert('No selections to save');
    return;
  }

  const completeLibrary = savedSelections.map(selection => {
    if (!selection.modelData && selection.type === "tab") {
      const model = MODELS[selection.model];
      selection.modelData = {
        numberOfStrings: model.numberOfStrings,
        numberOfFrets: model.numberOfFrets,
        startNote: model.startNote,
        startOctave: model.startOctave,
        endNote: model.endNote,
        endOctave: model.endOctave
      };
    }
    return selection;
  });

  const blob = new Blob([JSON.stringify(completeLibrary)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function loadLibrary() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const library = JSON.parse(e.target.result);
        if (Array.isArray(library)) {
          const valid = library.every(item => item.type === "tab" || item.type === "chord");
          if (!valid) throw new Error("Invalid library file format.");
          localStorage.setItem('harpejjiSelections', JSON.stringify(library));
          populateLibrary();
        } else {
          throw new Error('Invalid library file format');
        }
      } catch (error) {
        alert('Error loading library: ' + error.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// Scale filter helper
function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function allNotesInCurrentScale(notesArray) {
  const scaleSet = getScaleSemitones(currentScale, currentRoot);
  if (!scaleSet.size) return true;

  for (const noteStr of notesArray) {
    const firstSpace = noteStr.indexOf(" ");
    if (firstSpace < 0) {
      const noteData = noteStr.match(/^([A-G]#?)(\d*)$/);
      if (!noteData) return false;
      const rawNoteName = noteData[1];
      const noteIndex = NOTES.indexOf(rawNoteName);
      if (noteIndex < 0) return false;
      if (!scaleSet.has(noteIndex)) return false;
    } else {
      const noteNameOct = noteStr.substring(0, firstSpace); 
      let i = noteNameOct.length - 1;
      while (i >= 0 && isDigit(noteNameOct[i])) {
        i--;
      }
      const octaveStr = noteNameOct.substring(i + 1);
      const rawNoteName = noteNameOct.substring(0, i + 1);

      if (!rawNoteName) return false;
      const noteIndex = NOTES.indexOf(rawNoteName);
      if (noteIndex < 0) {
        return false;
      }
      if (!scaleSet.has(noteIndex)) {
        return false;
      }
    }
  }
  return true;
}

// ==============================
// Sequencer
// ==============================
const SEQUENCER_CONFIG = {
  pixelsPerBeat: 100,
  beatsPerBar: 4,
  bpm: 120,
  totalBars: 16,
  noteHeight: 20,
};

let isSequencerModeOn = false;
let isPlaying = false;
let isRecording = false;
let metronomeEnabled = false;
let currentBeat = 0;
let recordedNotes = [];

let activeNotes = new Map();

let playheadPosition = 0;
let audioStartTime = 0;

let globalSortedNotes = [];
let globalNoteToIndexMap = new Map();

let metronomeContext = null;
function initMetronome() {
  metronomeContext = audioContext || null;
}
function playMetronomeSound() {
  if (!metronomeContext) return;
  const beepOsc = audioContext.createOscillator();
  const beepGain = audioContext.createGain();
  beepOsc.frequency.value = 880;
  beepGain.gain.setValueAtTime(0.1, audioContext.currentTime);
  beepOsc.connect(beepGain).connect(audioContext.destination);
  beepOsc.start(audioContext.currentTime);
  beepOsc.stop(audioContext.currentTime + 0.05);
}

let isStepMode = false;
let stepModeTime = 0.0;
let isSelectMode = false;
let pitchPossiblePositions = {};
let pitchMappings = {};
let awaitingMappingPitch = null;

// For dragging notes
let draggingNote = null;
let dragStartX = 0;
let dragStartY = 0;
let dragOriginalStartTime = 0;
let dragOriginalNoteIndex = 0;
let resizingEdge = null; // 'left' or 'right'

// Undo/Redo
let undoStack = [];
let redoStack = [];

function pushHistory() {
  const snapshot = JSON.parse(JSON.stringify(recordedNotes));
  undoStack.push(snapshot);
  redoStack = [];
}

function undo() {
  if (undoStack.length > 0) {
    const current = JSON.parse(JSON.stringify(recordedNotes));
    redoStack.push(current);
    const previous = undoStack.pop();
    recordedNotes = previous;
    drawSequencerGrid();
  }
}

function redo() {
  if (redoStack.length > 0) {
    const current = JSON.parse(JSON.stringify(recordedNotes));
    undoStack.push(current);
    const next = redoStack.pop();
    recordedNotes = next;
    drawSequencerGrid();
  }
}

let sequencerSections = [];

function buildSortedNotesMapping() {
  let multiMap = {};
  for (let y = 0; y < numberOfFrets; y++) {
    for (let x = 0; x < numberOfStrings; x++) {
      const noteName = getNoteName(x, y);
      const octave   = getNoteOctave(x, y);
      const pitch = getMIDINumber(noteName, octave);
      if (!multiMap[pitch]) {
        multiMap[pitch] = [];
      }
      multiMap[pitch].push({ x, y, noteName, octave });
    }
  }

  let pitchMap = new Map();
  Object.keys(multiMap).forEach(p => {
    const pitch = parseInt(p, 10);
    const rep = multiMap[pitch][0];
    pitchMap.set(pitch, rep);
  });

  let uniqueNotes = Array.from(pitchMap.keys()).map(pitch => {
    const obj = pitchMap.get(pitch);
    return { noteName: obj.noteName, octave: obj.octave, pitch: pitch, x: obj.x, y: obj.y };
  });

  uniqueNotes.sort((a, b) => b.pitch - a.pitch);

  globalSortedNotes = uniqueNotes;
  globalNoteToIndexMap.clear();
  uniqueNotes.forEach((obj, index) => {
    const fullName = obj.noteName + obj.octave;
    globalNoteToIndexMap.set(fullName, index);
  });

  pitchPossiblePositions = multiMap;
}

function getMIDINumber(noteName, octave) {
  const noteIndex = NOTES.indexOf(noteName);
  return (octave + 1) * 12 + noteIndex;
}

function drawPianoRoll() {
  buildSortedNotesMapping();
  const pianoKeysContainer = document.getElementById('piano-keys');
  pianoKeysContainer.innerHTML = '';

  globalSortedNotes.forEach((noteObj) => {
    const { noteName, octave } = noteObj;
    const isBlack = isBlackNote(noteName);

    const key = document.createElement('div');
    key.style.height = `${SEQUENCER_CONFIG.noteHeight}px`;
    key.className = `border-b border-gray-700 flex items-center px-2 text-xs 
                     ${isBlack ? 'bg-gray-800' : 'bg-gray-700'} 
                     text-white`;
    key.textContent = noteName + octave;
    pianoKeysContainer.appendChild(key);
  });

  const totalHeight = globalSortedNotes.length * SEQUENCER_CONFIG.noteHeight;
  pianoKeysContainer.style.height = `${totalHeight}px`;

  const pianoRollWrapper = document.getElementById('piano-roll-wrapper');
  pianoRollWrapper.style.height = `${totalHeight}px`;
}

function drawSequencerGrid() {
  const gridContent = document.getElementById('grid-content');
  const playhead = document.getElementById('playhead');
  gridContent.innerHTML = '';

  const totalNotes = globalSortedNotes.length;
  const totalWidth = SEQUENCER_CONFIG.pixelsPerBeat * SEQUENCER_CONFIG.beatsPerBar * SEQUENCER_CONFIG.totalBars;
  const totalHeight = totalNotes * SEQUENCER_CONFIG.noteHeight;

  gridContent.style.width = `${totalWidth}px`;
  gridContent.style.height = `${totalHeight}px`;
  playhead.style.height = `${totalHeight}px`;

  for (let i = 0; i <= SEQUENCER_CONFIG.totalBars * SEQUENCER_CONFIG.beatsPerBar; i++) {
    const line = document.createElement('div');
    line.className = `absolute top-0 w-px h-full ${i % SEQUENCER_CONFIG.beatsPerBar === 0 ? 'bg-gray-500' : 'bg-gray-700'}`;
    line.style.left = `${i * SEQUENCER_CONFIG.pixelsPerBeat}px`;
    gridContent.appendChild(line);
  }

  for (let i = 0; i <= totalNotes; i++) {
    const line = document.createElement('div');
    line.className = 'absolute left-0 right-0 h-px bg-gray-700';
    line.style.top = `${i * SEQUENCER_CONFIG.noteHeight}px`;
    gridContent.appendChild(line);
  }

  sequencerSections.forEach(section => {
    const startBeat = (section.startBar - 1) * SEQUENCER_CONFIG.beatsPerBar;
    const endBeat = section.endBar * SEQUENCER_CONFIG.beatsPerBar;
    const leftPx = startBeat * SEQUENCER_CONFIG.pixelsPerBeat;
    const widthPx = (endBeat - startBeat) * SEQUENCER_CONFIG.pixelsPerBeat;

    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'absolute top-0 border-l border-r border-gray-400 bg-gray-200 bg-opacity-30 text-gray-800 text-xs flex items-center pl-1';
    sectionDiv.style.left = `${leftPx}px`;
    sectionDiv.style.width = `${widthPx}px`;
    sectionDiv.style.height = '20px';
    sectionDiv.textContent = section.name;
    gridContent.appendChild(sectionDiv);
  });

  recordedNotes.forEach((note, idx) => {
    const noteElement = document.createElement('div');
    noteElement.className = 'absolute bg-blue-500 opacity-75 rounded cursor-pointer note-event';

    const leftPx = note.startTime * (SEQUENCER_CONFIG.bpm / 60) * SEQUENCER_CONFIG.pixelsPerBeat;
    const widthPx = note.duration * (SEQUENCER_CONFIG.bpm / 60) * SEQUENCER_CONFIG.pixelsPerBeat;
    const topPx = note.noteIndex * SEQUENCER_CONFIG.noteHeight;

    noteElement.style.left = `${leftPx}px`;
    noteElement.style.top = `${topPx}px`;
    noteElement.style.width = `${widthPx}px`;
    noteElement.style.height = `${SEQUENCER_CONFIG.noteHeight}px`;

    noteElement.dataset.noteIdx = idx;

    if (note.selected) {
      noteElement.classList.add('ring');
      noteElement.classList.add('ring-offset-2');
      noteElement.classList.add('ring-yellow-300');
    }

    const leftHandle = document.createElement('div');
    leftHandle.className = 'absolute left-0 top-0 bottom-0 w-2 bg-transparent cursor-w-resize';
    noteElement.appendChild(leftHandle);

    const rightHandle = document.createElement('div');
    rightHandle.className = 'absolute right-0 top-0 bottom-0 w-2 bg-transparent cursor-e-resize';
    noteElement.appendChild(rightHandle);

    noteElement.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const rect = noteElement.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;

      draggingNote = note;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragOriginalStartTime = note.startTime;
      dragOriginalNoteIndex = note.noteIndex;
      resizingEdge = null;

      if (offsetX < 5) {
        resizingEdge = 'left';
      } else if (offsetX > rect.width - 5) {
        resizingEdge = 'right';
      }
    });

    noteElement.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!draggingNote) {
        note.selected = !note.selected;
        drawSequencerGrid();
      }
    });

    gridContent.appendChild(noteElement);
  });
}

document.addEventListener('mousemove', (e) => {
  if (!draggingNote) return;

  const dx = e.clientX - dragStartX;
  const timeOffset = dx / (SEQUENCER_CONFIG.pixelsPerBeat * (SEQUENCER_CONFIG.bpm / 60)) * 0.25;

  if (resizingEdge) {
    if (resizingEdge === 'left') {
      const newStart = Math.max(dragOriginalStartTime + timeOffset, 0);
      const oldEnd = draggingNote.startTime + draggingNote.duration;
      draggingNote.duration = oldEnd - newStart;
      draggingNote.startTime = newStart;
      if (draggingNote.duration < 0.05) {
        draggingNote.duration = 0.05;
      }
    } else {
      const newDuration = draggingNote.duration + timeOffset;
      if (newDuration > 0.05) {
        draggingNote.duration = newDuration;
      }
    }
  } else {
    const newStart = Math.max(dragOriginalStartTime + timeOffset, 0);
    draggingNote.startTime = newStart;

    const dy = e.clientY - dragStartY;
    const noteRowChange = Math.round(dy / SEQUENCER_CONFIG.noteHeight);
    let newIndex = dragOriginalNoteIndex + noteRowChange;
    newIndex = Math.max(0, Math.min(newIndex, globalSortedNotes.length - 1));
    draggingNote.noteIndex = newIndex;
    const newPitchObj = globalSortedNotes[newIndex];
    if (newPitchObj) {
      draggingNote.noteName = newPitchObj.noteName;
      draggingNote.octave = newPitchObj.octave;
      draggingNote.pitch = newPitchObj.pitch;
      draggingNote.x = newPitchObj.x;
      draggingNote.y = newPitchObj.y;
    }
  }
  drawSequencerGrid();
});

document.addEventListener('mouseup', () => {
  if (draggingNote) {
    pushHistory();
    draggingNote = null;
  }
  resizingEdge = null;
});

function startNoteRecording(x, y) {
  if (!isRecording) return;
  const noteName = getNoteName(x, y);
  const octave = getNoteOctave(x, y);
  const fullName = noteName + octave;

  const noteIndex = globalNoteToIndexMap.get(fullName);
  if (noteIndex === undefined) return;

  const now = audioContext ? audioContext.currentTime - audioStartTime : 0;
  const effectiveTime = isStepMode ? stepModeTime : now;

  activeNotes.set(fullName, { noteName, octave, noteIndex, startTime: effectiveTime, x, y, selected: false });
}

function stopNoteRecording(x, y) {
  if (!isRecording) return;
  const noteName = getNoteName(x, y);
  const octave = getNoteOctave(x, y);
  const fullName = noteName + octave;

  if (activeNotes.has(fullName)) {
    const activeNote = activeNotes.get(fullName);
    const now = audioContext ? audioContext.currentTime - audioStartTime : 0;
    const effectiveTime = isStepMode ? stepModeTime : now;

    let duration = effectiveTime - activeNote.startTime;
    if (isStepMode && duration <= 0) {
      duration = 60 / SEQUENCER_CONFIG.bpm;
    }

    recordedNotes.push({
      ...activeNote,
      duration,
      isPlaying: false,
      oscObj: null
    });
    activeNotes.delete(fullName);

    pushHistory();
    drawSequencerGrid();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  drawTablature();
  drawPianoRoll();
  drawSequencerGrid();

  const modelSelectEl = document.getElementById("modelSelect");
  modelSelectEl.addEventListener("change", () => {
    currentModel = MODELS[modelSelectEl.value];
    numberOfStrings = currentModel.numberOfStrings;
    numberOfFrets = currentModel.numberOfFrets;
    BASE_NOTE = currentModel.startNote;
    BASE_OCTAVE = currentModel.startOctave;
    
    initKeysState();
    drawTablature();
    drawPianoRoll();
    drawSequencerGrid();
  });

  const instrumentSelect = document.getElementById("instrumentSelect");
  instrumentSelect.addEventListener("change", () => {
    currentInstrument = instrumentSelect.value;
  });

  const scaleSelect = document.getElementById("scaleSelect");
  function populateScaleDropdown() {
    scaleSelect.innerHTML = `<option value="none">None</option>`;
    Object.keys(loadedScales).forEach(scaleName => {
      const opt = document.createElement('option');
      opt.value = scaleName;
      opt.textContent = scaleName;
      scaleSelect.appendChild(opt);
    });
  }
  populateScaleDropdown();
  scaleSelect.addEventListener("change", (e) => {
    currentScale = e.target.value;
    drawTablature();
  });

  const rootSelect = document.getElementById("rootSelect");
  rootSelect.addEventListener("change", (e) => {
    currentRoot = e.target.value;
    drawTablature();
  });

  document.getElementById("toggleNotesBtn").addEventListener("click", () => {
    showNotes = !showNotes;
    drawTablature();
  });
  document.getElementById("resetMarkersBtn").addEventListener("click", () => {
    initKeysState();
    drawTablature();
  });

  document.getElementById("saveBtn").addEventListener("click", saveSelection);
  document.getElementById("loadBtn").addEventListener("click", handleFileLoad);

  document.getElementById("libraryBtn").addEventListener("click", toggleLibrary);
  document.getElementById("closeLibraryBtn").addEventListener("click", toggleLibrary);
  populateLibrary();
  document.getElementById("importBtn").addEventListener("click", importFiles);
  document.getElementById("saveLibraryBtn").addEventListener("click", saveLibrary);
  document.getElementById("saveLibraryAsBtn").addEventListener("click", saveLibraryAs);
  document.getElementById("loadLibraryBtn").addEventListener("click", loadLibrary);
  document.getElementById("clearLibraryBtn").addEventListener("click", () => {
    if (confirm('Are you sure you want to clear the library?')) {
      localStorage.removeItem('harpejjiSelections');
      populateLibrary();
    }
  });

  document.getElementById("killNotesBtn").addEventListener("click", killAllNotes);

  document.getElementById('play-btn').addEventListener('click', () => {
    if (!audioContext) initAudio();
    if (!metronomeContext) initMetronome();
    isPlaying = true;
    audioStartTime = audioContext.currentTime;
    currentBeat = 0;
    document.getElementById('play-btn').classList.add('bg-green-600');
    updatePlayhead();
  });

  document.getElementById('stop-btn').addEventListener('click', () => {
    stopPlayback();
  });

  function stopPlayback() {
    isPlaying = false;
    isRecording = false;
    document.getElementById('play-btn').classList.remove('bg-green-600');
    document.getElementById('record-btn').classList.remove('bg-red-600');
    document.getElementById('record-indicator').classList.add('hidden');
    document.getElementById('playhead').style.left = '0';
    playheadPosition = 0;
    recordedNotes.forEach(note => {
      if (note.isPlaying && note.oscObj) {
        stopOscillator(note.oscObj);
        note.oscObj = null;
        note.isPlaying = false;
        keysState[note.y][note.x].sequencerPlaying = false;
      }
    });
    drawTablature();
    updatePlayhead();
  }

  document.getElementById('record-btn').addEventListener('click', () => {
    isRecording = !isRecording;
    const recordBtn = document.getElementById('record-btn');
    recordBtn.classList.toggle('bg-red-600');
    const indicator = document.getElementById('record-indicator');
    if (isRecording) {
      indicator.classList.remove('hidden');
      if (!isPlaying) {
        document.getElementById('play-btn').click();
      }
    } else {
      indicator.classList.add('hidden');
    }
  });

  document.getElementById('metronome-btn').addEventListener('click', () => {
    metronomeEnabled = !metronomeEnabled;
    document.getElementById('metronome-btn').classList.toggle('bg-blue-600');
  });

  document.getElementById('save-seq-btn').addEventListener('click', () => {
    const fileName = prompt('Enter a name for your sequence:', 'My Sequence');
    if (!fileName) return;
    const data = {
      name: fileName,
      bpm: SEQUENCER_CONFIG.bpm,
      notes: recordedNotes,
      timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('load-seq-btn').addEventListener('click', () => {
    const input = document.getElementById('load-seq-file');
    input.onchange = (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            SEQUENCER_CONFIG.bpm = data.bpm || 120;
            recordedNotes = data.notes || [];
            document.getElementById("tempoSlider").value = SEQUENCER_CONFIG.bpm;
            document.getElementById("tempoValue").textContent = `${SEQUENCER_CONFIG.bpm} BPM`;
            stopPlayback();
            drawSequencerGrid();
          } catch (error) {
            alert('Error loading sequence file');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  });

  document.getElementById("toggleSequencerModeBtn").addEventListener("click", () => {
    isSequencerModeOn = !isSequencerModeOn;
    const sequencerDiv = document.getElementById("sequencer");
    if (isSequencerModeOn) {
      sequencerDiv.classList.remove("hidden");
    } else {
      sequencerDiv.classList.add("hidden");
    }
  });

  document.getElementById("toggleKeyModeBtn").addEventListener("click", () => {
    if (keyMode === 'toggle') {
      keyMode = 'press';
      document.getElementById('toggleKeyModeBtn').textContent = "Key Mode: Press";
    } else {
      keyMode = 'toggle';
      document.getElementById('toggleKeyModeBtn').textContent = "Key Mode: Toggle";
    }
  });

  document.getElementById('mode-toggle-btn').addEventListener('click', () => {
    isStepMode = !isStepMode;
    document.getElementById('mode-toggle-btn').textContent = isStepMode ? 'Step Mode' : 'Song Mode';
  });

  document.getElementById('select-mode-btn').addEventListener('click', () => {
    isSelectMode = !isSelectMode;
    const btn = document.getElementById('select-mode-btn');
    btn.textContent = isSelectMode ? 'Select Mode: On' : 'Select Mode: Off';
    if (!isSelectMode) {
      awaitingMappingPitch = null;
      for (let fy = 0; fy < numberOfFrets; fy++) {
        for (let fx = 0; fx < numberOfStrings; fx++) {
          keysState[fy][fx].marker = false;
        }
      }
      drawTablature();
    }
  });

  document.getElementById('jump-btn').addEventListener('click', () => {
    const barVal = document.getElementById('barInput').value;
    const beatVal = document.getElementById('beatInput').value;
    jumpToPosition(barVal, beatVal);
  });

  function barBeatToSeconds(barString, beatString) {
    const bar = parseFloat(barString) || 1;
    const beat = parseFloat(beatString) || 1;
    const totalBeats = (bar - 1) * SEQUENCER_CONFIG.beatsPerBar + (beat - 1);
    return totalBeats * (60 / SEQUENCER_CONFIG.bpm);
  }

  function jumpToPosition(barString, beatString) {
    const timeInSec = barBeatToSeconds(barString, beatString);
    jumpToTime(timeInSec);
  }

  function jumpToTime(timeInSec) {
    recordedNotes.forEach(note => {
      if (note.isPlaying && note.oscObj) {
        stopOscillator(note.oscObj);
        note.oscObj = null;
        note.isPlaying = false;
        keysState[note.y][note.x].sequencerPlaying = false;
      }
    });
    drawTablature();
    if (isStepMode) {
      stepModeTime = timeInSec;
    } else {
      const now = audioContext ? audioContext.currentTime : 0;
      audioStartTime = now - timeInSec;
    }
    updateBarBeatDisplay(timeInSec);
    updatePlayhead();
  }

  function updateBarBeatDisplay(timeInSec) {
    const totalBeats = timeInSec * (SEQUENCER_CONFIG.bpm / 60);
    const bar = Math.floor(totalBeats / SEQUENCER_CONFIG.beatsPerBar) + 1;
    const beat = (totalBeats % SEQUENCER_CONFIG.beatsPerBar) + 1;
    document.getElementById('barInput').value = bar.toString();
    document.getElementById('beatInput').value = beat.toFixed(2);
  }

  function updatePlayhead() {
    let now = 0;
    if (isStepMode) {
      now = stepModeTime;
    } else if (audioContext) {
      now = audioContext.currentTime - audioStartTime;
    }
    updateBarBeatDisplay(now);
    playheadPosition = (now * SEQUENCER_CONFIG.bpm / 60) * SEQUENCER_CONFIG.pixelsPerBeat;
    const playhead = document.getElementById('playhead');
    playhead.style.left = `${playheadPosition}px`;

    if (isPlaying && !isStepMode) {
      const currentTimeBeat = Math.floor(now * SEQUENCER_CONFIG.bpm / 60);
      if (currentTimeBeat > currentBeat) {
        currentBeat = currentTimeBeat;
        if (metronomeEnabled) {
          playMetronomeSound();
        }
      }
      recordedNotes.forEach(note => {
        const noteStart = note.startTime;
        const noteEnd = noteStart + note.duration;
        if (now >= noteStart && now < noteEnd) {
          if (!note.isPlaying) {
            note.isPlaying = true;
            let freq;
            const chosenMapping = pitchMappings[note.pitch];
            if (chosenMapping) {
              const mappedNoteName = getNoteName(chosenMapping.x, chosenMapping.y);
              const mappedOct = getNoteOctave(chosenMapping.x, chosenMapping.y);
              freq = noteToFrequency(mappedNoteName, mappedOct);
            } else {
              freq = noteToFrequency(note.noteName, note.octave);
            }
            const oscObj = createOscillator(freq, currentInstrument);
            note.oscObj = oscObj;
            keysState[note.y][note.x].sequencerPlaying = true;
            drawTablature();
          }
        } else if (now >= noteEnd && note.isPlaying) {
          note.isPlaying = false;
          if (note.oscObj) {
            stopOscillator(note.oscObj);
            note.oscObj = null;
          }
          if (fadeNotes) {
            keysState[note.y][note.x].sequencerPlaying = false;
            keysState[note.y][note.x].fading = true;
            keysState[note.y][note.x].fadeOutStart = performance.now();
          } else {
            keysState[note.y][note.x].sequencerPlaying = false;
          }
          drawTablature();
        }
      });
      requestAnimationFrame(updatePlayhead);
    } else if (isPlaying) {
      requestAnimationFrame(updatePlayhead);
    }
  }

  const advancedConfigBtn = document.getElementById("advancedConfigBtn");
  const advancedConfigSlideover = document.getElementById("advancedConfigSlideover");
  const closeAdvancedConfigBtn = document.getElementById("closeAdvancedConfigBtn");

  advancedConfigBtn.addEventListener("click", () => {
    advancedConfigSlideover.classList.toggle("hidden");
  });
  closeAdvancedConfigBtn.addEventListener("click", () => {
    advancedConfigSlideover.classList.add("hidden");
  });

  const cursorColorPicker = document.getElementById("cursorColorPicker");
  cursorColorPicker.addEventListener("input", (e) => {
    const color = e.target.value;
    document.getElementById("playhead").style.backgroundColor = color;
  });

  const rowSpacingRange = document.getElementById("rowSpacingRange");
  const rowSpacingValue = document.getElementById("rowSpacingValue");
  rowSpacingRange.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    fretSpacing = val;
    rowSpacingValue.textContent = val + " px";
    drawTablature();
  });

  const scaleHighlightColorInput = document.getElementById("scaleHighlightColor");
  scaleHighlightColorInput.addEventListener("input", (e) => {
    scaleHighlightColor = e.target.value;
    drawTablature();
  });

  const scaleHighlightAlphaRange = document.getElementById("scaleHighlightAlpha");
  const scaleHighlightAlphaValue = document.getElementById("scaleHighlightAlphaValue");
  scaleHighlightAlphaRange.addEventListener("input", (e) => {
    scaleHighlightAlpha = parseFloat(e.target.value);
    scaleHighlightAlphaValue.textContent = scaleHighlightAlpha.toString();
    drawTablature();
  });

  const scaleHighlightModeSelect = document.getElementById("scaleHighlightModeSelect");
  scaleHighlightModeSelect.addEventListener("change", (e) => {
    scaleHighlightMode = e.target.value;
    drawTablature();
  });

  const fingerOverlayColorPicker = document.getElementById("fingerOverlayColorPicker");
  fingerOverlayColorPicker.addEventListener("input", (e) => {
    fingerOverlayColor = e.target.value;
    drawTablature();
  });

  const importScalesBtn = document.getElementById("importScalesBtn");
  const scaleFileInput = document.getElementById("scaleFileInput");
  importScalesBtn.addEventListener("click", () => {
    scaleFileInput.click();
  });
  scaleFileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        Object.keys(imported).forEach(name => {
          loadedScales[name] = imported[name];
        });
        populateScaleDropdown();
        alert("Scales imported successfully.");
      } catch(err) {
        alert("Error importing scales: " + err.message);
      }
      scaleFileInput.value = "";
    };
    reader.readAsText(file);
  });

  // NEW: Fade Notes Toggle and Fade Time
  const fadeNotesToggle = document.getElementById("fadeNotesToggle");
  const fadeNotesTimeRange = document.getElementById("fadeNotesTimeRange");
  const fadeNotesTimeValue = document.getElementById("fadeNotesTimeValue");

  fadeNotesToggle.addEventListener("change", () => {
    fadeNotes = fadeNotesToggle.checked;
  });

  fadeNotesTimeRange.addEventListener("input", () => {
    fadeTime = parseFloat(fadeNotesTimeRange.value);
    fadeNotesTimeValue.textContent = fadeTime.toFixed(1);
  });

  // "Save Configuration File" (Advanced Config only)
  document.getElementById("saveProjectBtn").addEventListener("click", () => {
    const advancedOptions = {
      cursorColor: cursorColorPicker.value,
      rowSpacing: fretSpacing,
      scaleHighlightColor,
      scaleHighlightAlpha,
      scaleHighlightMode,
      fingerOverlayColor,
      fadeNotes: fadeNotesToggle.checked,
      fadeTime: parseFloat(fadeNotesTimeRange.value)
    };
    const dataToSave = {
      advancedOptions
    };
    const blob = new Blob([JSON.stringify(dataToSave)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'harpejji_config.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // "Load Configuration File" (Advanced Config only)
  document.getElementById("loadProjectBtn").addEventListener("click", () => {
    const input = document.getElementById('loadProjectFile');
    input.onchange = (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.advancedOptions) {
            const ao = data.advancedOptions;
            if (ao.cursorColor) {
              cursorColorPicker.value = ao.cursorColor;
              document.getElementById("playhead").style.backgroundColor = ao.cursorColor;
            }
            if (typeof ao.rowSpacing === 'number') {
              fretSpacing = ao.rowSpacing;
              rowSpacingRange.value = ao.rowSpacing;
              rowSpacingValue.textContent = ao.rowSpacing + ' px';
            }
            if (ao.scaleHighlightColor) {
              scaleHighlightColor = ao.scaleHighlightColor;
              scaleHighlightColorInput.value = ao.scaleHighlightColor;
            }
            if (typeof ao.scaleHighlightAlpha === 'number') {
              scaleHighlightAlpha = ao.scaleHighlightAlpha;
              scaleHighlightAlphaRange.value = ao.scaleHighlightAlpha;
              scaleHighlightAlphaValue.textContent = ao.scaleHighlightAlpha;
            }
            if (ao.scaleHighlightMode) {
              scaleHighlightMode = ao.scaleHighlightMode;
              scaleHighlightModeSelect.value = ao.scaleHighlightMode;
            }
            if (ao.fingerOverlayColor) {
              fingerOverlayColor = ao.fingerOverlayColor;
              fingerOverlayColorPicker.value = ao.fingerOverlayColor;
            }
            if (typeof ao.fadeNotes === 'boolean') {
              fadeNotes = ao.fadeNotes;
              fadeNotesToggle.checked = ao.fadeNotes;
            }
            if (typeof ao.fadeTime === 'number') {
              fadeTime = ao.fadeTime;
              fadeNotesTimeRange.value = ao.fadeTime;
              fadeNotesTimeValue.textContent = ao.fadeTime.toFixed(1);
            }
            drawTablature();
          }
          alert("Configuration loaded successfully.");
        } catch (error) {
          alert("Error loading configuration file: " + error.message);
        }
        input.value = "";
      };
      reader.readAsText(file);
    };
    input.click();
  });

  // High-Level Save/Load Project Buttons
  document.getElementById("saveHighLevelProjectBtn").addEventListener("click", () => {
    const advancedOptions = {
      cursorColor: cursorColorPicker.value,
      rowSpacing: fretSpacing,
      scaleHighlightColor,
      scaleHighlightAlpha,
      scaleHighlightMode,
      fingerOverlayColor,
      fadeNotes: fadeNotesToggle.checked,
      fadeTime: parseFloat(fadeNotesTimeRange.value)
    };
    const library = JSON.parse(localStorage.getItem('harpejjiSelections') || '[]');
    const chordPalette = chordSlots;
    const sequencerData = {
      bpm: SEQUENCER_CONFIG.bpm,
      notes: recordedNotes,
      pitchMappings
    };
    const scalesData = loadedScales;
    // Also include current keysState, model, etc.
    const highLevelData = {
      advancedOptions,
      library,
      chordPalette,
      sequencerData,
      scalesData,
      keysState,
      currentModel,
      showNotes,
      currentScale,
      currentRoot,
      keyMode
    };
    const blob = new Blob([JSON.stringify(highLevelData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'harpejji_project.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("loadHighLevelProjectBtn").addEventListener("click", () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);

          // advanced options
          if (data.advancedOptions) {
            const ao = data.advancedOptions;
            if (ao.cursorColor) {
              cursorColorPicker.value = ao.cursorColor;
              document.getElementById("playhead").style.backgroundColor = ao.cursorColor;
            }
            if (typeof ao.rowSpacing === 'number') {
              fretSpacing = ao.rowSpacing;
              rowSpacingRange.value = ao.rowSpacing;
              rowSpacingValue.textContent = ao.rowSpacing + ' px';
            }
            if (ao.scaleHighlightColor) {
              scaleHighlightColor = ao.scaleHighlightColor;
              scaleHighlightColorInput.value = ao.scaleHighlightColor;
            }
            if (typeof ao.scaleHighlightAlpha === 'number') {
              scaleHighlightAlpha = ao.scaleHighlightAlpha;
              scaleHighlightAlphaRange.value = ao.scaleHighlightAlpha;
              scaleHighlightAlphaValue.textContent = ao.scaleHighlightAlpha;
            }
            if (ao.scaleHighlightMode) {
              scaleHighlightMode = ao.scaleHighlightMode;
              scaleHighlightModeSelect.value = ao.scaleHighlightMode;
            }
            if (ao.fingerOverlayColor) {
              fingerOverlayColor = ao.fingerOverlayColor;
              fingerOverlayColorPicker.value = ao.fingerOverlayColor;
            }
            if (typeof ao.fadeNotes === 'boolean') {
              fadeNotes = ao.fadeNotes;
              fadeNotesToggle.checked = ao.fadeNotes;
            }
            if (typeof ao.fadeTime === 'number') {
              fadeTime = ao.fadeTime;
              fadeNotesTimeRange.value = ao.fadeTime;
              fadeNotesTimeValue.textContent = ao.fadeTime.toFixed(1);
            }
            drawTablature();
          }

          // library
          if (data.library && Array.isArray(data.library)) {
            localStorage.setItem('harpejjiSelections', JSON.stringify(data.library));
            populateLibrary();
          }

          // chord palette
          if (data.chordPalette && Array.isArray(data.chordPalette)) {
            chordSlots.forEach((slot, idx) => {
              if (data.chordPalette[idx]) {
                slot.name = data.chordPalette[idx].name || slot.name;
                slot.keys = Array.isArray(data.chordPalette[idx].keys) ? data.chordPalette[idx].keys : [];
              }
            });
            updateChordPaletteUI();
          }

          // sequencer
          if (data.sequencerData) {
            SEQUENCER_CONFIG.bpm = data.sequencerData.bpm || 120;
            recordedNotes = data.sequencerData.notes || [];
            pitchMappings = data.sequencerData.pitchMappings || {};
            document.getElementById("tempoSlider").value = SEQUENCER_CONFIG.bpm;
            document.getElementById("tempoValue").textContent = `${SEQUENCER_CONFIG.bpm} BPM`;
            stopPlayback();
            drawSequencerGrid();
          }

          // scales
          if (data.scalesData) {
            loadedScales = data.scalesData;
            populateScaleDropdown();
          }

          // keysState
          if (data.keysState) {
            keysState = data.keysState;
            drawTablature();
          }

          // model, showNotes, scale, root, keyMode
          if (data.currentModel) {
            currentModel = data.currentModel;
            numberOfStrings = currentModel.numberOfStrings;
            numberOfFrets = currentModel.numberOfFrets;
            BASE_NOTE = currentModel.startNote;
            BASE_OCTAVE = currentModel.startOctave;
            drawTablature();
            drawPianoRoll();
            drawSequencerGrid();
          }
          if (typeof data.showNotes === 'boolean') {
            showNotes = data.showNotes;
          }
          if (data.currentScale) {
            currentScale = data.currentScale;
            scaleSelect.value = currentScale; // Set dropdown to loaded scale
          }
          if (data.currentRoot) {
            currentRoot = data.currentRoot;
            rootSelect.value = currentRoot; // Set dropdown to loaded root
          }
          if (data.keyMode) {
            keyMode = data.keyMode;
            document.getElementById('toggleKeyModeBtn').textContent = 
              keyMode === 'press' ? "Key Mode: Press" : "Key Mode: Toggle";
          }

          drawTablature();
          alert("Project loaded successfully.");
        } catch (error) {
          alert("Error loading project: " + error.message);
        }
        input.value = "";
      };
      reader.readAsText(file);
    };
    input.click();
  });

  document.querySelectorAll('.chord-record-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-chord-index'), 10);
      toggleChordRecord(idx);
    });
  });
  document.querySelectorAll('.chord-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-chord-index'), 10);
      clearChordNotes(idx);
    });
  });
  document.querySelectorAll('.chord-rename-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-chord-index'), 10);
      renameChordSlot(idx);
    });
  });
  document.querySelectorAll('.chord-save-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-chord-index'), 10);
      saveChordToFile(idx);
    });
  });
  document.querySelectorAll('.chord-send-lib-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-chord-index'), 10);
      sendChordToLibrary(idx);
    });
  });

  window.chordModeSelect = document.getElementById("chordModeSelect");
  window.strumPaceInput = document.getElementById("strumPaceInput");
  window.strumPaceUnit = document.getElementById("strumPaceUnit");
  window.clearTabOnTriggerCheckbox = document.getElementById("clearTabOnTrigger");

  document.querySelectorAll('.chord-button').forEach(btn => {
    const slot = btn.closest('.chord-slot');
    const idx = parseInt(slot.getAttribute('data-chord-index'), 10);

    btn.addEventListener('click', () => {
      if (clearTabOnTriggerCheckbox.checked) {
        clearAllTabMarkers();
      }
      if (chordModeSelect.value === 'press') {
        if (keyMode === 'toggle') {
          chordToggle(idx);
        }
      } else if (chordModeSelect.value === 'strum') {
        chordStrum(idx);
      }
    });

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (chordModeSelect.value === 'press') {
        if (clearTabOnTriggerCheckbox.checked) {
          clearAllTabMarkers();
        }
        if (keyMode === 'press') {
          chordPressDown(idx);
        }
      }
    });
    btn.addEventListener('mouseup', (e) => {
      e.preventDefault();
      if (chordModeSelect.value === 'press') {
        if (keyMode === 'press') {
          chordPressUp(idx);
        }
      }
    });
    btn.addEventListener('mouseleave', (e) => {
      if (chordModeSelect.value === 'press') {
        if (keyMode === 'press' && e.buttons === 1) {
          chordPressUp(idx);
        }
      }
    });
  });

  document.getElementById("saveChordsBtn").addEventListener("click", () => {
    const confirmation = confirm("Are you sure you want to save all chords in the palette to the library?");
    if (!confirmation) return;
    chordSlots.forEach((chord, idx) => {
      if (chord.keys.length > 0) {
        sendChordToLibrary(idx);
      }
    });
  });

  document.getElementById("saveChordsToFileBtn").addEventListener("click", () => {
    const allChordsData = chordSlots.map(ch => ({
      type: "chord",
      name: ch.name,
      keys: ch.keys.map(k => ({
        x: k.x,
        y: k.y,
        noteName: k.noteName,
        octave: k.octave
      }))
    }));
    const blob = new Blob([JSON.stringify(allChordsData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'harpejji_chords.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // *** FIXED: Loading a chord set from a file does NOT prompt for a slot. ***
  document.getElementById("loadChordsBtn").addEventListener("click", () => {
    const input = document.getElementById("loadChordsFile");
    input.onchange = (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const loadedChords = JSON.parse(e.target.result);
          if (Array.isArray(loadedChords)) {
            // Auto-place chords without prompting
            let slotIndex = 0;
            loadedChords.forEach(chordData => {
              if (chordData.type === "chord" && slotIndex < 8) {
                chordSlots[slotIndex].name = chordData.name;
                chordSlots[slotIndex].keys = chordData.keys.map(k => ({
                  x: k.x,
                  y: k.y,
                  noteName: k.noteName,
                  octave: k.octave
                }));
                slotIndex++;
              }
            });
            updateChordPaletteUI();
            alert("Chords loaded successfully.");
          } else {
            throw new Error("Invalid chord file structure.");
          }
        } catch (err) {
          alert("Error loading chord file: " + err.message);
        }
        input.value = "";
      };
      reader.readAsText(file);
    };
    input.click();
  });

  document.getElementById('delaySlider').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (delayGain) {
      delayGain.gain.value = val;
    }
  });
  document.getElementById('reverbSlider').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (reverbGain) {
      reverbGain.gain.value = val;
    }
  });

  const tempoSlider = document.getElementById('tempoSlider');
  const tempoValue = document.getElementById('tempoValue');
  tempoSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    SEQUENCER_CONFIG.bpm = val;
    tempoValue.textContent = `${val} BPM`;
  });

  const sequencerGridEl = document.getElementById('sequencer-grid');
  sequencerGridEl.addEventListener('click', (e) => {
    const rect = sequencerGridEl.getBoundingClientRect();
    const x = e.clientX - rect.left + sequencerGridEl.scrollLeft;
    const timeInSec = x / (SEQUENCER_CONFIG.pixelsPerBeat * (SEQUENCER_CONFIG.bpm / 60));
    jumpToTime(timeInSec);
  });

  document.getElementById('undo-btn').addEventListener('click', () => {
    undo();
  });
  document.getElementById('redo-btn').addEventListener('click', () => {
    redo();
  });

  document.getElementById('delete-notes-btn').addEventListener('click', () => {
    const oldLength = recordedNotes.length;
    recordedNotes = recordedNotes.filter(n => !n.selected);
    if (recordedNotes.length !== oldLength) {
      pushHistory();
      drawSequencerGrid();
    }
  });

  document.getElementById('add-section-btn').addEventListener('click', () => {
    const startBar = parseInt(prompt("Enter start bar:", "1"), 10);
    const endBar = parseInt(prompt("Enter end bar:", "2"), 10);
    const name = prompt("Enter section name:", "Intro");
    if (isNaN(startBar) || isNaN(endBar) || !name) {
      alert("Invalid section data.");
      return;
    }
    sequencerSections.push({ startBar, endBar, name });
    drawSequencerGrid();
  });
});

// ==============================
// "Find Chord" Button Logic
// ==============================
const findChordBtn = document.getElementById("findChordBtn");
const findChordPopup = document.getElementById("findChordPopup");
const closeChordPopup = document.getElementById("closeChordPopup");
const chordMatchesDiv = document.getElementById("chordMatches");

findChordBtn.addEventListener("click", () => {
  const selectedPositions = [];
  for (let y = 0; y < numberOfFrets; y++) {
    for (let x = 0; x < numberOfStrings; x++) {
      if (keysState[y][x].marker) {
        const noteName = getNoteName(x, y);
        const octave = getNoteOctave(x, y);
        const pitchClass = NOTES.indexOf(noteName);
        selectedPositions.push({ noteName, octave, pitchClass });
      }
    }
  }

  if (selectedPositions.length === 0) {
    chordMatchesDiv.innerHTML = "<p class='text-red-600'>No notes selected.</p>";
    findChordPopup.classList.remove("hidden");
    return;
  }

  const uniquePitchClasses = Array.from(new Set(selectedPositions.map(sp => sp.pitchClass)));

  let chordResults = [];

  for (let rootPc of uniquePitchClasses) {
    const shiftedSet = uniquePitchClasses.map(pc => mod(pc - rootPc, 12));

    CHORD_DEFINITIONS.forEach(chDef => {
      let matchCount = 0;
      chDef.intervals.forEach(interval => {
        if (shiftedSet.includes(mod(interval,12))) {
          matchCount++;
        }
      });
      const rootName = NOTES[rootPc];
      chordResults.push({
        chordName: `${rootName} ${chDef.name}`,
        totalChordIntervals: chDef.intervals.length,
        matchedIntervals: matchCount
      });
    });
  }

  chordResults.sort((a,b) => {
    if (b.matchedIntervals === a.matchedIntervals) {
      return a.totalChordIntervals - b.totalChordIntervals;
    }
    return b.matchedIntervals - a.matchedIntervals;
  });

  const topMatches = chordResults.slice(0, 8);

  if (topMatches.length === 0) {
    chordMatchesDiv.innerHTML = "<p class='text-gray-600'>No chord matches found.</p>";
  } else {
    chordMatchesDiv.innerHTML = topMatches.map(match => {
      return `
        <div>
          <strong>${match.chordName}</strong>
          <span class="ml-2 text-gray-700">
            (Matched ${match.matchedIntervals} / ${match.totalChordIntervals})
          </span>
        </div>
      `;
    }).join("");
  }

  findChordPopup.classList.remove("hidden");
});

closeChordPopup.addEventListener("click", () => {
  findChordPopup.classList.add("hidden");
});

// ==============================
// "Play Current Selection" Button
// ==============================
function playNoteTemporary(x, y, duration) {
  const noteName = getNoteName(x, y);
  const octave = getNoteOctave(x, y);
  const freq = noteToFrequency(noteName, octave);
  const oscObj = createOscillator(freq, currentInstrument);
  setTimeout(() => {
    stopOscillator(oscObj);
  }, duration);
}

document.getElementById("playSelectionBtn").addEventListener("click", () => {
  const selectedKeys = [];
  for (let y = 0; y < numberOfFrets; y++) {
    for (let x = 0; x < numberOfStrings; x++) {
      if (keysState[y][x].marker) {
        selectedKeys.push({ x, y });
      }
    }
  }
  selectedKeys.forEach(pos => {
    playNoteTemporary(pos.x, pos.y, 300);
  });
});

// ==============================
// Shift Up/Down/Left/Right
// ==============================
function shiftSelection(dx, dy) {
  const selectedPositions = [];
  for (let y = 0; y < numberOfFrets; y++) {
    for (let x = 0; x < numberOfStrings; x++) {
      if (keysState[y][x].marker) {
        selectedPositions.push({ x, y });
      }
    }
  }
  selectedPositions.forEach(pos => {
    const oldX = pos.x;
    const oldY = pos.y;
    const newX = oldX + dx;
    const newY = oldY + dy;
    if (newX >= 0 && newX < numberOfStrings && newY >= 0 && newY < numberOfFrets) {
      keysState[oldY][oldX].marker = false;
      keysState[oldY][oldX].finger = null;
      keysState[oldY][oldX].fading = false;
      keysState[oldY][oldX].fadeOutStart = null;
      keysState[newY][newX].marker = true;
      // When newly toggled on, finger assignment is lost unless user sets again
      // (as per requirement "must be set again subsequently if they so desire")
    }
  });
  drawTablature();
}

// ==============================
// Event Listeners for Library Filters
// ==============================
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('input[name="libraryFilter"]').forEach(radio => {
    radio.addEventListener('change', populateLibrary);
  });
  document.getElementById("scaleFilterCheckbox").addEventListener("change", populateLibrary);

  const modelFilterSelect = document.getElementById("modelFilterSelect");
  if (modelFilterSelect) {
    modelFilterSelect.addEventListener("change", populateLibrary);
  }
});
