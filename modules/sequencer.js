import { appState } from './state.js';
import { audioEngine } from './audio.js';
import { tablature } from './tablature.js';

class Sequencer {
  constructor() {
    this.animationFrameId = null;
    this.lastDrawTime = 0;
    this.selectedNotes = new Set();
  }

  init() {
    // Initialize sequencer UI references
    this.sequencerGrid = document.getElementById("sequencer-grid");
    this.gridContent = document.getElementById("grid-content");
    this.playhead = document.getElementById("playhead");
    this.pianoKeys = document.getElementById("piano-keys");
    this.recordIndicator = document.getElementById("record-indicator");

    // Initialize transport controls
    this.setupTransportControls();
    this.setupEventListeners();

    // Draw initial grid and piano roll
    this.drawGrid();
    this.drawPianoRoll();
  }

  drawGrid() {
    if (!this.gridContent) return;

    const totalWidth = appState.SEQUENCER_CONFIG.pixelsPerBeat * 
                      appState.SEQUENCER_CONFIG.beatsPerBar * 
                      appState.SEQUENCER_CONFIG.totalBars;
    const totalHeight = appState.numberOfFrets * appState.SEQUENCER_CONFIG.noteHeight;

    this.gridContent.style.width = `${totalWidth}px`;
    this.gridContent.style.height = `${totalHeight}px`;
    this.gridContent.style.position = 'relative';
    this.gridContent.style.backgroundColor = '#1a1a1a';

    // Draw vertical bar lines
    for (let bar = 0; bar <= appState.SEQUENCER_CONFIG.totalBars; bar++) {
      const line = document.createElement('div');
      line.style.position = 'absolute';
      line.style.left = `${bar * appState.SEQUENCER_CONFIG.pixelsPerBeat * appState.SEQUENCER_CONFIG.beatsPerBar}px`;
      line.style.top = '0';
      line.style.width = '1px';
      line.style.height = '100%';
      line.style.backgroundColor = bar % 4 === 0 ? '#666' : '#333';
      this.gridContent.appendChild(line);
    }

    // Draw horizontal note lines
    for (let row = 0; row <= appState.numberOfFrets; row++) {
      const line = document.createElement('div');
      line.style.position = 'absolute';
      line.style.left = '0';
      line.style.top = `${row * appState.SEQUENCER_CONFIG.noteHeight}px`;
      line.style.width = '100%';
      line.style.height = '1px';
      line.style.backgroundColor = '#333';
      this.gridContent.appendChild(line);
    }
  }

  drawPianoRoll() {
    if (!this.pianoKeys) return;

    this.pianoKeys.style.height = `${appState.numberOfFrets * appState.SEQUENCER_CONFIG.noteHeight}px`;
    this.pianoKeys.innerHTML = '';

    for (let y = 0; y < appState.numberOfFrets; y++) {
      for (let x = 0; x < appState.numberOfStrings; x++) {
        const noteName = appState.getNoteName(x, y);
        const octave = appState.getNoteOctave(x, y);
        const isBlack = noteName.includes('#');

        const key = document.createElement('div');
        key.className = 'piano-key';
        key.style.position = 'absolute';
        key.style.left = '0';
        key.style.top = `${y * appState.SEQUENCER_CONFIG.noteHeight}px`;
        key.style.width = '100%';
        key.style.height = `${appState.SEQUENCER_CONFIG.noteHeight - 1}px`;
        key.style.backgroundColor = isBlack ? '#333' : '#fff';
        key.style.border = '1px solid #666';
        key.style.color = isBlack ? '#fff' : '#000';
        key.style.fontSize = '10px';
        key.style.padding = '2px';
        key.textContent = `${noteName}${octave}`;

        this.pianoKeys.appendChild(key);
      }
    }
  }

  setupTransportControls() {
    // Play button
    document.getElementById("play-btn").addEventListener("click", () => {
      if (!appState.isPlaying) {
        this.startPlayback();
      } else {
        this.stopPlayback();
      }
    });

    // Stop button
    document.getElementById("stop-btn").addEventListener("click", () => {
      this.stopPlayback();
      appState.playheadPosition = 0;
      this.updatePlayhead();
    });

    // Record button
    document.getElementById("record-btn").addEventListener("click", () => {
      appState.isRecording = !appState.isRecording;
      this.recordIndicator.classList.toggle("hidden", !appState.isRecording);
    });

    // Metronome button
    document.getElementById("metronome-btn").addEventListener("click", () => {
      appState.metronomeEnabled = !appState.metronomeEnabled;
      document.getElementById("metronome-btn").classList.toggle("bg-blue-700");
    });

    // Mode toggle button
    document.getElementById("mode-toggle-btn").addEventListener("click", () => {
      appState.isStepMode = !appState.isStepMode;
      document.getElementById("mode-toggle-btn").textContent = 
        appState.isStepMode ? "Step Mode" : "Song Mode";
    });
  }

  setupEventListeners() {
    // Bar/Beat input handlers
    document.getElementById("barInput").addEventListener("change", (e) => {
      const bar = Math.max(1, parseInt(e.target.value) || 1);
      e.target.value = bar;
    });

    document.getElementById("beatInput").addEventListener("change", (e) => {
      const beat = Math.max(1, Math.min(parseInt(e.target.value) || 1, appState.SEQUENCER_CONFIG.beatsPerBar));
      e.target.value = beat;
    });

    // Jump button
    document.getElementById("jump-btn").addEventListener("click", () => {
      const bar = parseInt(document.getElementById("barInput").value) || 1;
      const beat = parseInt(document.getElementById("beatInput").value) || 1;
      const position = ((bar - 1) * appState.SEQUENCER_CONFIG.beatsPerBar + (beat - 1)) 
        * appState.SEQUENCER_CONFIG.pixelsPerBeat;
      appState.playheadPosition = position;
      this.updatePlayhead();
    });
  }

  startPlayback() {
    console.log('Starting playback...');
    
    // Check for required elements
    const playBtn = document.getElementById("play-btn");
    const playhead = document.getElementById("playhead");
    if (!playBtn || !playhead) {
      console.error('Required elements not found:', { playBtn, playhead });
      return;
    }

    appState.isPlaying = true;
    playBtn.textContent = "Pause";
    playBtn.classList.add("bg-yellow-500");
    playBtn.classList.remove("bg-green-500");
    
    appState.audioStartTime = audioEngine.currentTime - (appState.playheadPosition / appState.SEQUENCER_CONFIG.pixelsPerBeat * (60 / appState.SEQUENCER_CONFIG.bpm));
    this.lastDrawTime = performance.now();
    console.log('Animation starting with:', {
      audioStartTime: appState.audioStartTime,
      lastDrawTime: this.lastDrawTime,
      playheadPosition: appState.playheadPosition
    });
    this.animate(performance.now());
  }

  stopPlayback() {
    console.log('Stopping playback...');
    appState.isPlaying = false;
    document.getElementById("play-btn").textContent = "Play";
    document.getElementById("play-btn").classList.add("bg-green-500");
    document.getElementById("play-btn").classList.remove("bg-yellow-500");

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Stop all playing notes
    for (let [key, soundObj] of appState.activeNotes.entries()) {
      soundObj.stop();
    }
    appState.activeNotes.clear();
    tablature.draw();
  }

  animate(currentTime = performance.now()) {
    if (!appState.isPlaying) {
      console.log('Animation stopped: playback inactive');
      this.stopPlayback();
      return;
    }

    const deltaTime = currentTime - this.lastDrawTime;
    this.lastDrawTime = currentTime;

    // Update playhead position
    const pixelsPerMs = (appState.SEQUENCER_CONFIG.pixelsPerBeat * appState.SEQUENCER_CONFIG.bpm) / (60 * 1000);
    appState.playheadPosition += deltaTime * pixelsPerMs;
    console.log('Animation frame:', {
      deltaTime,
      pixelsPerMs,
      playheadPosition: appState.playheadPosition
    });

    // Check for end of sequence
    const totalWidth = appState.SEQUENCER_CONFIG.pixelsPerBeat * appState.SEQUENCER_CONFIG.beatsPerBar * appState.SEQUENCER_CONFIG.totalBars;
    if (appState.playheadPosition >= totalWidth) {
      appState.playheadPosition = 0;
      appState.audioStartTime = audioEngine.currentTime;
    }

    // Update visual playhead
    this.updatePlayhead();

    // Play metronome if enabled
    const beat = Math.floor(appState.playheadPosition / appState.SEQUENCER_CONFIG.pixelsPerBeat);
    if (appState.metronomeEnabled && beat !== appState.currentBeat) {
      appState.currentBeat = beat;
      if (beat % appState.SEQUENCER_CONFIG.beatsPerBar === 0) {
        audioEngine.playMetronomeClick();
      }
    }

    // Play recorded notes
    const currentBeat = appState.playheadPosition / appState.SEQUENCER_CONFIG.pixelsPerBeat;
    appState.recordedNotes.forEach(note => {
      const noteKey = `${note.x}_${note.y}`;
      const isNoteActive = appState.activeNotes.has(noteKey);
      const shouldPlay = currentBeat >= note.startBeat && 
                        currentBeat < note.startBeat + note.duration;

      if (shouldPlay && !isNoteActive) {
        // Start note
        const soundObj = audioEngine.playNote(note.noteName, note.octave, appState.currentInstrument);
        appState.activeNotes.set(noteKey, soundObj);
        appState.setKeyState(note.x, note.y, 'sequencerPlaying', true);
      } else if (!shouldPlay && isNoteActive) {
        // Stop note
        const soundObj = appState.activeNotes.get(noteKey);
        soundObj.stop();
        appState.activeNotes.delete(noteKey);
        appState.setKeyState(note.x, note.y, 'sequencerPlaying', false);
      }
    });

    tablature.draw();

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame((time) => this.animate(time));
  }

  updatePlayhead() {
    if (this.playhead) {
      this.playhead.style.position = 'absolute';
      this.playhead.style.top = '0';
      this.playhead.style.height = '100%';
      this.playhead.style.width = '2px';
      this.playhead.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
      this.playhead.style.pointerEvents = 'none';
      this.playhead.style.left = `${appState.playheadPosition}px`;
      this.playhead.style.zIndex = '1000';
      this.playhead.style.transition = appState.isPlaying ? 'none' : 'left 0.1s ease-out';
    }
  }

  // Record a note
  recordNote(x, y, startTime) {
    if (!appState.isRecording || !appState.isPlaying) return;

    const noteName = appState.getNoteName(x, y);
    const octave = appState.getNoteOctave(x, y);
    const beat = (audioEngine.currentTime - appState.audioStartTime) * (appState.SEQUENCER_CONFIG.bpm / 60);
    
    appState.recordedNotes.push({
      x, y,
      noteName,
      octave,
      startBeat: beat,
      duration: 0.25 // Default to quarter note
    });
  }
}

export const sequencer = new Sequencer();
