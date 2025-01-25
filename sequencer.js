/******************************************************
 * sequencer.js
 *
 * Manages:
 *  - The sequencer's note data (`recordedNotes`)
 *  - Play/stop, record, metronome, step vs. song mode
 *  - Drawing the piano roll & grid
 *  - Note dragging/resizing in the grid
 *  - Undo/Redo
 *  - Sections, bar/beat jumping
 ******************************************************/

import {
    NOTES,
    keysState,
    currentInstrument,
    noteToFrequency,
    fadeNotes,
    fadeTime,
    BASE_NOTE,
    BASE_OCTAVE,
    showNotes, // optional
    numberOfFrets,
    numberOfStrings
  } from "./globals.js";
  
  import {
    createOscillator,
    stopOscillator,
    initAudio,
    killAllNotes
  } from "./audio.js";
  
  import { drawTablature } from "./tablature.js";
  
  /**
   * The main config for the sequencer visuals:
   */
  export const SEQUENCER_CONFIG = {
    pixelsPerBeat: 100,
    beatsPerBar: 4,
    bpm: 120,
    totalBars: 16,
    noteHeight: 20
  };
  
  /**
   * The array of note objects:
   *   { noteName, octave, noteIndex, pitch, startTime, duration, isPlaying, oscObj, x, y, selected }
   */
  export let recordedNotes = [];
  
  /**
   * For note dragging:
   */
  let draggingNote = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginalStartTime = 0;
  let dragOriginalNoteIndex = 0;
  let resizingEdge = null; // "left" or "right"
  
  /**
   * Undo/Redo:
   */
  let undoStack = [];
  let redoStack = [];
  
  /**
   * Step vs. Song mode:
   */
  export let isStepMode = false;
  let stepModeTime = 0.0;
  
  /**
   * Playback state:
   */
  export let isSequencerModeOn = false; // toggling the UI
  export let isPlaying = false;
  export let isRecording = false;
  export let metronomeEnabled = false;
  export let currentBeat = 0;
  let audioStartTime = 0;
  let playheadPosition = 0;
  
  /**
   * We also keep an activeNotes map while recording:
   *   key = "noteName+octave", value = { startTime, etc. }
   */
  let activeNotes = new Map();
  
  /**
   * pitchMappings is if we want to re-map certain pitches in the sequencer
   * to different x/y or frequencies. By default it’s empty.
   */
  export let pitchMappings = {};
  
  /**
   * We can define named sections for the timeline if we wish.
   */
  export let sequencerSections = [];
  
  // We'll store a sorted list of unique pitches in the current model
  let globalSortedNotes = [];
  let globalNoteToIndexMap = new Map();
  
  /******************************************************
   * buildSortedNotesMapping():
   * Gathers all x,y => pitch so we can build a piano-roll
   * from highest pitch to lowest pitch.
   ******************************************************/
  function buildSortedNotesMapping() {
    let multiMap = {};
    for (let y = 0; y < numberOfFrets; y++) {
      for (let x = 0; x < numberOfStrings; x++) {
        const noteName = getNoteName(x, y);
        const octave   = getNoteOctave(x, y);
        const pitch    = getMIDINumber(noteName, octave);
        if (!multiMap[pitch]) {
          multiMap[pitch] = [];
        }
        multiMap[pitch].push({ x, y, noteName, octave });
      }
    }
    // For each pitch, just pick the first instance
    let pitchMap = new Map();
    Object.keys(multiMap).forEach(p => {
      const pitch = parseInt(p,10);
      const rep = multiMap[pitch][0];
      pitchMap.set(pitch, rep);
    });
  
    let unique = Array.from(pitchMap.keys()).map(p => {
      const obj = pitchMap.get(p);
      return { pitch: p, noteName: obj.noteName, octave: obj.octave, x: obj.x, y: obj.y };
    });
  
    // Sort descending pitch
    unique.sort((a,b)=>b.pitch - a.pitch);
    globalSortedNotes = unique;
    globalNoteToIndexMap.clear();
    unique.forEach((obj,idx) => {
      const full = obj.noteName + obj.octave;
      globalNoteToIndexMap.set(full, idx);
    });
  }
  
  /******************************************************
   * getNoteName(x, y):
   * Each column => +2 semitones, row => +1 semitone
   ******************************************************/
  function getNoteName(x, y) {
    const noteIndex = NOTES.indexOf(BASE_NOTE);
    const semitones = x*2 + y;
    const newIdx = mod(noteIndex + semitones, NOTES.length);
    return NOTES[newIdx];
  }
  
  /******************************************************
   * getNoteOctave(x,y)
   ******************************************************/
  function getNoteOctave(x,y) {
    const noteIndex = NOTES.indexOf(BASE_NOTE);
    const semitones = x*2 + y;
    const total = noteIndex + semitones;
    const octShift = Math.floor(total / NOTES.length);
    return BASE_OCTAVE + octShift;
  }
  
  /******************************************************
   * mod helper
   ******************************************************/
  function mod(n,m) {
    return ((n%m)+m)%m;
  }
  
  /******************************************************
   * getMIDINumber(noteName, octave):
   * C-1 => 0, C0 => 12, etc. A4 => 69 if we want that standard
   ******************************************************/
  function getMIDINumber(noteName, octave) {
    const noteIdx = NOTES.indexOf(noteName);
    return (octave + 1)*12 + noteIdx; 
  }
  
  /******************************************************
   * drawPianoRoll():
   * Builds the left column of note names in descending pitch.
   ******************************************************/
  export function drawPianoRoll() {
    buildSortedNotesMapping();
    const pianoKeysContainer = document.getElementById("piano-keys");
    if (!pianoKeysContainer) return;
  
    pianoKeysContainer.innerHTML = "";
  
    globalSortedNotes.forEach((obj) => {
      const { noteName, octave } = obj;
      const isBlack = noteName.includes("#");
      const keyDiv = document.createElement("div");
      keyDiv.style.height = SEQUENCER_CONFIG.noteHeight + "px";
      keyDiv.className = `
        border-b border-gray-700 flex items-center px-2 text-xs 
        ${isBlack ? "bg-gray-800" : "bg-gray-700"}
        text-white
      `;
      keyDiv.textContent = noteName + octave;
      pianoKeysContainer.appendChild(keyDiv);
    });
  
    const totalHeight = globalSortedNotes.length * SEQUENCER_CONFIG.noteHeight;
    pianoKeysContainer.style.height = totalHeight + "px";
    
    const pianoRollWrapper = document.getElementById("piano-roll-wrapper");
    if (pianoRollWrapper) {
      pianoRollWrapper.style.height = totalHeight + "px";
    }
  }
  
  /******************************************************
   * drawSequencerGrid():
   * Draws vertical lines for each beat, horizontal lines
   * for each note row, and all recorded notes as divs.
   ******************************************************/
  export function drawSequencerGrid() {
    const gridContent = document.getElementById("grid-content");
    const playhead = document.getElementById("playhead");
    if (!gridContent || !playhead) return;
  
    gridContent.innerHTML = "";
  
    const totalNotes = globalSortedNotes.length;
    const totalWidth = SEQUENCER_CONFIG.pixelsPerBeat * SEQUENCER_CONFIG.beatsPerBar * SEQUENCER_CONFIG.totalBars;
    const totalHeight = totalNotes * SEQUENCER_CONFIG.noteHeight;
  
    gridContent.style.width = totalWidth + "px";
    gridContent.style.height = totalHeight + "px";
    playhead.style.height = totalHeight + "px";
  
    // vertical beat lines
    for (let i=0; i<= SEQUENCER_CONFIG.totalBars*SEQUENCER_CONFIG.beatsPerBar; i++){
      const line = document.createElement("div");
      line.className = `absolute top-0 w-px h-full ${ (i%SEQUENCER_CONFIG.beatsPerBar===0) ? "bg-gray-500" : "bg-gray-700" }`;
      line.style.left = (i * SEQUENCER_CONFIG.pixelsPerBeat)+"px";
      gridContent.appendChild(line);
    }
  
    // horizontal note lines
    for (let i=0; i<= totalNotes; i++){
      const line = document.createElement("div");
      line.className = `absolute left-0 right-0 h-px bg-gray-700`;
      line.style.top = (i*SEQUENCER_CONFIG.noteHeight)+"px";
      gridContent.appendChild(line);
    }
  
    // sections
    sequencerSections.forEach(section => {
      const startBeat = (section.startBar -1)*SEQUENCER_CONFIG.beatsPerBar;
      const endBeat   = section.endBar * SEQUENCER_CONFIG.beatsPerBar;
      const leftPx = startBeat * SEQUENCER_CONFIG.pixelsPerBeat;
      const widthPx= (endBeat - startBeat)*SEQUENCER_CONFIG.pixelsPerBeat;
      const sectionDiv = document.createElement("div");
      sectionDiv.className = `absolute top-0 border-l border-r border-gray-400 bg-gray-200 bg-opacity-30 text-gray-800 text-xs flex items-center pl-1`;
      sectionDiv.style.left= leftPx+"px";
      sectionDiv.style.width= widthPx+"px";
      sectionDiv.style.height= "20px";
      sectionDiv.textContent = section.name;
      gridContent.appendChild(sectionDiv);
    });
  
    // draw notes
    recordedNotes.forEach((note, idx) => {
      const noteDiv = document.createElement("div");
      noteDiv.className = "absolute bg-blue-500 opacity-75 rounded cursor-pointer note-event";
  
      const startPx = note.startTime * (SEQUENCER_CONFIG.bpm/60)*SEQUENCER_CONFIG.pixelsPerBeat;
      const widthPx = note.duration * (SEQUENCER_CONFIG.bpm/60)*SEQUENCER_CONFIG.pixelsPerBeat;
      const topPx = note.noteIndex * SEQUENCER_CONFIG.noteHeight;
  
      noteDiv.style.left  = startPx+"px";
      noteDiv.style.top   = topPx+"px";
      noteDiv.style.width = widthPx+"px";
      noteDiv.style.height= SEQUENCER_CONFIG.noteHeight+"px";
      noteDiv.dataset.noteIdx = idx;
      if (note.selected) {
        noteDiv.classList.add("ring","ring-offset-2","ring-yellow-300");
      }
  
      // Left handle
      const leftHandle = document.createElement("div");
      leftHandle.className = "absolute left-0 top-0 bottom-0 w-2 bg-transparent cursor-w-resize";
      noteDiv.appendChild(leftHandle);
  
      // Right handle
      const rightHandle = document.createElement("div");
      rightHandle.className = "absolute right-0 top-0 bottom-0 w-2 bg-transparent cursor-e-resize";
      noteDiv.appendChild(rightHandle);
  
      // Mousedown => drag or resize
      noteDiv.addEventListener("mousedown", (e)=>{
        e.stopPropagation();
        const rect = noteDiv.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        draggingNote = note;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragOriginalStartTime = note.startTime;
        dragOriginalNoteIndex = note.noteIndex;
        resizingEdge = null;
        if (offsetX<5) {
          resizingEdge="left";
        } else if (offsetX> rect.width-5) {
          resizingEdge="right";
        }
      });
  
      noteDiv.addEventListener("click", (e)=>{
        e.stopPropagation();
        if (!draggingNote) {
          note.selected = !note.selected;
          drawSequencerGrid();
        }
      });
  
      gridContent.appendChild(noteDiv);
    });
  }
  
  /******************************************************
   * Handle global mousemove for dragging note/resizing
   ******************************************************/
  document.addEventListener("mousemove",(e)=>{
    if (!draggingNote) return;
    const dx = e.clientX - dragStartX;
    // Convert dx to time offset in seconds
    const secPerBeat = 60/SEQUENCER_CONFIG.bpm;
    const pxPerSec   = SEQUENCER_CONFIG.pixelsPerBeat / secPerBeat;
    const dt = dx / pxPerSec;
  
    if (resizingEdge) {
      if (resizingEdge==="left") {
        const newStart = Math.max(dragOriginalStartTime+dt, 0);
        const oldEnd   = draggingNote.startTime + draggingNote.duration;
        draggingNote.startTime= newStart;
        draggingNote.duration= oldEnd - newStart;
        if (draggingNote.duration<0.05) draggingNote.duration=0.05;
      } else {
        // resizing right
        const newDur = draggingNote.duration + dt;
        if (newDur>0.05) {
          draggingNote.duration= newDur;
        }
      }
    } else {
      // dragging the note horizontally
      const newStart = Math.max(dragOriginalStartTime+dt,0);
      draggingNote.startTime = newStart;
  
      // also drag vertically
      const dy = e.clientY - dragStartY;
      const rowChange = Math.round(dy/ SEQUENCER_CONFIG.noteHeight);
      let newIndex = dragOriginalNoteIndex + rowChange;
      newIndex= Math.max(0, Math.min(newIndex, globalSortedNotes.length-1));
      draggingNote.noteIndex = newIndex;
      const pitchObj = globalSortedNotes[newIndex];
      if (pitchObj) {
        draggingNote.noteName = pitchObj.noteName;
        draggingNote.octave   = pitchObj.octave;
        draggingNote.pitch    = pitchObj.pitch;
        draggingNote.x        = pitchObj.x;
        draggingNote.y        = pitchObj.y;
      }
    }
    drawSequencerGrid();
  });
  
  document.addEventListener("mouseup",()=>{
    if (draggingNote) {
      pushHistory();
      draggingNote=null;
    }
    resizingEdge=null;
  });
  
  /******************************************************
   * startNoteRecording(x,y):
   * If isRecording, we store a note object in activeNotes
   ******************************************************/
  export function startNoteRecording(x,y) {
    if (!isRecording) return;
    const noteName = getNoteName(x,y);
    const octave   = getNoteOctave(x,y);
    const fullName = noteName + octave;
    const noteIndex= globalNoteToIndexMap.get(fullName);
    if (noteIndex===undefined) return;
  
    let now=0;
    if (isStepMode) now= stepModeTime;
    else if (window.audioContext) {
      now= window.audioContext.currentTime - audioStartTime;
    }
  
    activeNotes.set(fullName,{
      noteName, octave, noteIndex,
      startTime:now, x,y, selected:false
    });
  }
  
  /******************************************************
   * stopNoteRecording(x,y):
   * If isRecording, finalize the note's duration
   * and push into recordedNotes.
   ******************************************************/
  export function stopNoteRecording(x,y) {
    if (!isRecording) return;
    const noteName = getNoteName(x,y);
    const octave   = getNoteOctave(x,y);
    const fullName = noteName+octave;
    if (!activeNotes.has(fullName)) return;
  
    let now=0;
    if (isStepMode) now= stepModeTime;
    else if (window.audioContext) {
      now= window.audioContext.currentTime - audioStartTime;
    }
  
    const activeN = activeNotes.get(fullName);
    let dur = now - activeN.startTime;
    if (isStepMode && dur<=0) {
      dur= 60/SEQUENCER_CONFIG.bpm; // minimal step
    }
  
    recordedNotes.push({
      ...activeN,
      duration: dur,
      isPlaying: false,
      oscObj:null
    });
    activeNotes.delete(fullName);
  
    pushHistory();
    drawSequencerGrid();
  }
  
  /******************************************************
   * Playback
   ******************************************************/
  export function startPlayback() {
    initAudio();
    isPlaying= true;
    audioStartTime= window.audioContext.currentTime;
    currentBeat=0;
    document.getElementById("play-btn")?.classList.add("bg-green-600");
    updatePlayhead();
  }
  
  export function stopPlayback() {
    isPlaying=false;
    isRecording=false;
    document.getElementById("play-btn")?.classList.remove("bg-green-600");
    document.getElementById("record-btn")?.classList.remove("bg-red-600");
    document.getElementById("record-indicator")?.classList.add("hidden");
    document.getElementById("playhead").style.left = "0";
    playheadPosition=0;
    // Stop all playing notes
    recordedNotes.forEach(n=>{
      if(n.isPlaying && n.oscObj) {
        stopOscillator(n.oscObj);
        n.oscObj=null;
        n.isPlaying=false;
        keysState[n.y][n.x].sequencerPlaying=false;
      }
    });
    drawTablature();
    updatePlayhead();
  }
  
  /******************************************************
   * updatePlayhead():
   * Called in a loop while isPlaying to move the "playhead"
   ******************************************************/
  function updatePlayhead() {
    let now=0;
    if (isStepMode) {
      now= stepModeTime;
    } else if(window.audioContext && isPlaying){
      now= window.audioContext.currentTime - audioStartTime;
    }
  
    // update bar/beat display
    const barInput = document.getElementById("barInput");
    const beatInput= document.getElementById("beatInput");
    const totalBeats= now*(SEQUENCER_CONFIG.bpm/60);
    const bar = Math.floor(totalBeats/ SEQUENCER_CONFIG.beatsPerBar)+1;
    const beat= (totalBeats % SEQUENCER_CONFIG.beatsPerBar)+1;
    if(barInput && beatInput){
      barInput.value= bar.toString();
      beatInput.value= beat.toFixed(2);
    }
  
    // compute playhead position in px
    playheadPosition= totalBeats * SEQUENCER_CONFIG.pixelsPerBeat;
    const playhead= document.getElementById("playhead");
    if (playhead) {
      playhead.style.left= playheadPosition + "px";
    }
  
    if(isPlaying && !isStepMode) {
      // check metronome
      const currIntBeat = Math.floor(totalBeats);
      if(currIntBeat> currentBeat){
        currentBeat= currIntBeat;
        if(metronomeEnabled) {
          playMetronomeSound();
        }
      }
      // process note on/off
      recordedNotes.forEach(note=>{
        const start= note.startTime;
        const end  = start+ note.duration;
        if(now>=start && now<end){
          if(!note.isPlaying){
            note.isPlaying= true;
            let freq;
            const mapped = pitchMappings[note.pitch];
            if(mapped) {
              const mappedName= getNoteName(mapped.x,mapped.y);
              const mappedOct = getNoteOctave(mapped.x,mapped.y);
              freq= noteToFrequency(mappedName,mappedOct);
            } else {
              freq= noteToFrequency(note.noteName,note.octave);
            }
            const osc= createOscillator(freq, currentInstrument);
            note.oscObj= osc;
            keysState[note.y][note.x].sequencerPlaying=true;
            drawTablature();
          }
        } else if(now>=end && note.isPlaying){
          note.isPlaying=false;
          if(note.oscObj) {
            stopOscillator(note.oscObj);
            note.oscObj=null;
          }
          if(fadeNotes){
            keysState[note.y][note.x].sequencerPlaying=false;
            keysState[note.y][note.x].fading= true;
            keysState[note.y][note.x].fadeOutStart= performance.now();
          } else {
            keysState[note.y][note.x].sequencerPlaying=false;
          }
          drawTablature();
        }
      });
      requestAnimationFrame(updatePlayhead);
    } else if (isPlaying) {
      // step mode => we still re-call updatePlayhead but user must manually adv?
      requestAnimationFrame(updatePlayhead);
    }
  }
  
  /******************************************************
   * playMetronomeSound():
   * Quick beep for each beat if metronome is enabled
   ******************************************************/
  function playMetronomeSound() {
    if(!window.audioContext) return;
    const beepOsc= window.audioContext.createOscillator();
    const beepGain= window.audioContext.createGain();
    beepOsc.frequency.value= 880;
    beepGain.gain.setValueAtTime(0.1, window.audioContext.currentTime);
    beepOsc.connect(beepGain).connect(window.audioContext.destination);
    beepOsc.start(window.audioContext.currentTime);
    beepOsc.stop(window.audioContext.currentTime+0.05);
  }
  
  /******************************************************
   * jumpToTime(seconds):
   * forcibly jump the playback to a certain time
   ******************************************************/
  export function jumpToTime(sec) {
    // stop any currently playing notes
    recordedNotes.forEach(note=>{
      if(note.isPlaying && note.oscObj){
        stopOscillator(note.oscObj);
        note.oscObj=null;
        note.isPlaying= false;
        keysState[note.y][note.x].sequencerPlaying=false;
      }
    });
    drawTablature();
    if(isStepMode) {
      stepModeTime= sec;
    } else {
      if(window.audioContext){
        const now= window.audioContext.currentTime;
        audioStartTime= now- sec;
      }
    }
    updateBarBeatDisplay(sec);
    updatePlayhead();
  }
  
  /******************************************************
   * updateBarBeatDisplay(sec):
   * helper for jumpToTime
   ******************************************************/
  function updateBarBeatDisplay(sec){
    const totalBeats= sec*(SEQUENCER_CONFIG.bpm/60);
    const bar= Math.floor(totalBeats/ SEQUENCER_CONFIG.beatsPerBar)+1;
    const beat= (totalBeats % SEQUENCER_CONFIG.beatsPerBar)+1;
    const barInput = document.getElementById("barInput");
    const beatInput= document.getElementById("beatInput");
    if(barInput && beatInput){
      barInput.value= bar.toString();
      beatInput.value= beat.toFixed(2);
    }
  }
  
  /******************************************************
   * jumpToPosition(barString, beatString):
   * parse bar/beat => seconds => jump
   ******************************************************/
  export function jumpToPosition(barString, beatString){
    const bar = parseFloat(barString)||1;
    const beat= parseFloat(beatString)||1;
    const totalBeats= (bar-1)*SEQUENCER_CONFIG.beatsPerBar + (beat-1);
    const timeInSec= totalBeats*(60/ SEQUENCER_CONFIG.bpm);
    jumpToTime(timeInSec);
  }
  
  /******************************************************
   * pushHistory():
   * Saves a snapshot of recordedNotes for undo
   ******************************************************/
  export function pushHistory() {
    const snap = JSON.parse(JSON.stringify(recordedNotes));
    undoStack.push(snap);
    redoStack=[];
  }
  
  /******************************************************
   * undo():
   * Revert to previous snapshot
   ******************************************************/
  export function undo() {
    if(!undoStack.length) return;
    const current = JSON.parse(JSON.stringify(recordedNotes));
    redoStack.push(current);
    const prev = undoStack.pop();
    recordedNotes= prev;
    drawSequencerGrid();
  }
  
  /******************************************************
   * redo():
   ******************************************************/
  export function redo() {
    if(!redoStack.length) return;
    const current = JSON.parse(JSON.stringify(recordedNotes));
    undoStack.push(current);
    const next = redoStack.pop();
    recordedNotes= next;
    drawSequencerGrid();
  }
  
  /******************************************************
   * deleteSelectedNotes():
   * remove any notes with selected=true
   ******************************************************/
  export function deleteSelectedNotes() {
    const oldLen = recordedNotes.length;
    recordedNotes= recordedNotes.filter(n=>!n.selected);
    if(recordedNotes.length!== oldLen){
      pushHistory();
      drawSequencerGrid();
    }
  }
  
  /******************************************************
   * addSection():
   * define a named section from startBar..endBar
   ******************************************************/
  export function addSection() {
    const startBar= parseInt(prompt("Enter start bar:", "1"),10);
    const endBar  = parseInt(prompt("Enter end bar:", "2"),10);
    const name    = prompt("Enter section name:", "Intro");
    if(isNaN(startBar)||isNaN(endBar)||!name){
      alert("Invalid section data");
      return;
    }
    sequencerSections.push({ startBar, endBar, name });
    drawSequencerGrid();
  }
  
  /******************************************************
   * toggling step mode vs. song mode
   ******************************************************/
  export function toggleStepMode() {
    isStepMode= !isStepMode;
  }
  
  /******************************************************
   * setSequencerBPM(newBPM):
   ******************************************************/
  export function setSequencerBPM(newBPM) {
    SEQUENCER_CONFIG.bpm= newBPM;
  }
  
  /******************************************************
   * A click in the sequencer-grid => jump
   ******************************************************/
  const sequencerGrid = document.getElementById("sequencer-grid");
  if(sequencerGrid){
    sequencerGrid.addEventListener("click",(e)=>{
      const rect = sequencerGrid.getBoundingClientRect();
      const x = e.clientX - rect.left + sequencerGrid.scrollLeft;
      const timeInSec= x/( SEQUENCER_CONFIG.pixelsPerBeat*(SEQUENCER_CONFIG.bpm/60));
      jumpToTime(timeInSec);
    });
  }
  
  /******************************************************
   * Helper function to read noteName & octave from
   * pitchMappings if we want. Already integrated above.
   ******************************************************/
  