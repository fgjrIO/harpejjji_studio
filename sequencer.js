/******************************************************
 * sequencer.js
 *
 * Manages:
 *  - recordedNotes => array of note events
 *  - play/stop, record, step vs. song mode
 *  - drawing the piano roll & sequencer grid
 *  - dragging/resizing notes
 *  - undo/redo
 *  - sections, jump to bar/beat
 *  - metronome scheduling that stays in sync with audio time
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
  showNotes,
  numberOfFrets,
  numberOfStrings,
  getNoteName,
  getNoteOctave
} from "./globals.js";

import {
  initAudio,
  createOscillator,
  stopOscillator
} from "./audio.js";

import { drawTablature } from "./tablature.js";

/******************************************************
* SEQUENCER_CONFIG => visual & timing settings
******************************************************/
export const SEQUENCER_CONFIG = {
  pixelsPerBeat: 100,
  beatsPerBar: 4,
  bpm: 120,
  totalBars: 16,
  noteHeight: 20
};

export let recordedNotes = [];
let draggingNote = null;
let dragStartX = 0;
let dragStartY = 0;
let dragOriginalStartTime = 0;
let dragOriginalNoteIndex = 0;
let resizingEdge = null;

let undoStack = [];
let redoStack = [];

export let isStepMode = false;
let stepModeTime = 0.0;

export let isSequencerModeOn = false;
export let isPlaying = false;
export let isRecording = false;

export let currentBeat = 0;
let audioStartTime = 0;
let playheadPosition = 0;

let activeNotes = new Map();
export let pitchMappings = {};
export let sequencerSections = [];

let globalSortedNotes = [];
let globalNoteToIndexMap = new Map();

/******************************************************
* Metronome scheduling - tight sync with audio time
******************************************************/
let metronomeIsOn = false;           // True if user toggles "Metronome" on
let metronomeSchedulerId = null;     // setInterval ID for scheduling loop
let nextMetronomeTime = 0;           // Next beep time in AudioContext seconds
const scheduleAheadTime = 0.1;       // How far ahead (seconds) we schedule beeps
const schedulerInterval = 25;        // ms between scheduling checks

/**
 * toggleMetronome(isOn)
 * Called from the index.html "metronomeToggle" checkbox.
 */
export function toggleMetronome(isOn) {
  metronomeIsOn = isOn;
  if (!metronomeIsOn) {
    stopMetronomeScheduling();
  } else {
    // If user toggles on and we’re already playing => start scheduling
    if (isPlaying && window.audioContext) {
      startMetronomeScheduling();
    }
  }
}

/**
 * startMetronomeScheduling()
 * Schedules a repeated check for upcoming beats.
 */
function startMetronomeScheduling() {
  if (!window.audioContext) return;
  if (metronomeSchedulerId) clearInterval(metronomeSchedulerId);
  // Reset next beat time to "now"
  nextMetronomeTime = window.audioContext.currentTime;
  // Repeatedly schedule upcoming beeps in small time windows
  metronomeSchedulerId = setInterval(metronomeScheduler, schedulerInterval);
}

/**
 * stopMetronomeScheduling()
 */
function stopMetronomeScheduling() {
  if (metronomeSchedulerId) {
    clearInterval(metronomeSchedulerId);
    metronomeSchedulerId = null;
  }
}

/**
 * The scheduling loop that looks ahead and places new beep(s).
 */
function metronomeScheduler() {
  if (!metronomeIsOn || !isPlaying || !window.audioContext) return;
  const now = window.audioContext.currentTime;
  const secondsPerBeat = 60 / SEQUENCER_CONFIG.bpm;
  // While our next scheduled beep is within the upcoming 0.1s window:
  while (nextMetronomeTime < now + scheduleAheadTime) {
    scheduleMetronomeBeep(nextMetronomeTime);
    nextMetronomeTime += secondsPerBeat;
  }
}

/**
 * scheduleMetronomeBeep(time)
 * Schedules the beep at "time" in the AudioContext timeline.
 */
function scheduleMetronomeBeep(time) {
  const ctx = window.audioContext;
  if (!ctx) return;

  // short beep using an oscillator at 880 Hz
  const beepGain = ctx.createGain();
  beepGain.gain.value = 0.25;
  beepGain.connect(ctx.masterGain || ctx.destination);

  const osc = ctx.createOscillator();
  osc.frequency.value = 880; // beep frequency
  osc.type = "square";
  osc.connect(beepGain);

  osc.start(time);

  // Envelope out over ~50ms:
  const endTime = time + 0.05;
  beepGain.gain.setValueAtTime(0.25, time);
  beepGain.gain.linearRampToValueAtTime(0, endTime);

  osc.stop(endTime);
  osc.onended = () => {
    osc.disconnect();
    beepGain.disconnect();
  };
}

/******************************************************
* buildSortedNotesMapping():
******************************************************/
function buildSortedNotesMapping() {
  let multiMap = {};
  const A4_OCT = 4;
  const A4_Idx = NOTES.indexOf("A");

  for (let y=0; y< numberOfFrets; y++){
    for (let x=0; x< numberOfStrings; x++){
      const nName = getNoteName(x,y);
      const oct = getNoteOctave(x,y);
      const noteIdx = NOTES.indexOf(nName);
      const pitch = (oct - A4_OCT)*12 + (noteIdx - A4_Idx);

      if(!multiMap[pitch]){
        multiMap[pitch]= [];
      }
      multiMap[pitch].push({ x, y, noteName:nName, octave: oct });
    }
  }
  let pitchMap= new Map();
  Object.keys(multiMap).forEach(pk=>{
    const pInt= parseInt(pk,10);
    const rep= multiMap[pInt][0];
    pitchMap.set(pInt, rep);
  });

  let unique= Array.from(pitchMap.keys()).map(pInt=>{
    const obj= pitchMap.get(pInt);
    return {
      pitch: pInt,
      noteName: obj.noteName,
      octave: obj.octave,
      x: obj.x,
      y: obj.y
    };
  });

  unique.sort((a,b)=> b.pitch - a.pitch);
  globalSortedNotes= unique;
  globalNoteToIndexMap.clear();
  unique.forEach((o,idx)=>{
    const full= o.noteName+ o.octave;
    globalNoteToIndexMap.set(full, idx);
  });
}

/******************************************************
* drawPianoRoll():
******************************************************/
export function drawPianoRoll() {
  buildSortedNotesMapping();
  const pianoKeysContainer = document.getElementById("piano-keys");
  if(!pianoKeysContainer) return;

  pianoKeysContainer.innerHTML= "";

  globalSortedNotes.forEach((obj)=>{
    const { noteName, octave }= obj;
    const isBlack= noteName.includes("#");
    const keyDiv= document.createElement("div");
    keyDiv.style.height= SEQUENCER_CONFIG.noteHeight+"px";
    keyDiv.className= `
      border-b border-gray-700 flex items-center px-2 text-xs
      ${isBlack? "bg-gray-800":"bg-gray-700"}
      text-white
    `;
    keyDiv.textContent= noteName+ octave;
    pianoKeysContainer.appendChild(keyDiv);
  });

  const totalHeight= globalSortedNotes.length * SEQUENCER_CONFIG.noteHeight;
  pianoKeysContainer.style.height= totalHeight+"px";

  const pianoRollWrapper= document.getElementById("piano-roll-wrapper");
  if(pianoRollWrapper) {
    pianoRollWrapper.style.height= totalHeight+"px";
  }
}

/******************************************************
* drawSequencerGrid():
******************************************************/
export function drawSequencerGrid() {
  const gridContent= document.getElementById("grid-content");
  const playhead= document.getElementById("playhead");
  if(!gridContent || !playhead) return;

  gridContent.innerHTML= "";

  const totalNotes= globalSortedNotes.length;
  const totalWidth= SEQUENCER_CONFIG.pixelsPerBeat * SEQUENCER_CONFIG.beatsPerBar * SEQUENCER_CONFIG.totalBars;
  const totalHeight= totalNotes* SEQUENCER_CONFIG.noteHeight;

  gridContent.style.width= totalWidth+"px";
  gridContent.style.height= totalHeight+"px";
  playhead.style.height= totalHeight+"px";

  // vertical lines for each beat
  for (let i=0; i<= SEQUENCER_CONFIG.totalBars* SEQUENCER_CONFIG.beatsPerBar; i++){
    const line= document.createElement("div");
    line.className= `absolute top-0 w-px h-full ${(i % SEQUENCER_CONFIG.beatsPerBar===0) ? "bg-gray-500":"bg-gray-700"}`;
    line.style.left= (i* SEQUENCER_CONFIG.pixelsPerBeat)+"px";
    gridContent.appendChild(line);
  }

  // horizontal lines for each note row
  for (let i=0; i<= totalNotes; i++){
    const line= document.createElement("div");
    line.className= "absolute left-0 right-0 h-px bg-gray-700";
    line.style.top= (i* SEQUENCER_CONFIG.noteHeight)+"px";
    gridContent.appendChild(line);
  }

  // sections overlay (if any)
  sequencerSections.forEach(sec=>{
    const startBeat= (sec.startBar-1)* SEQUENCER_CONFIG.beatsPerBar;
    const endBeat  = sec.endBar* SEQUENCER_CONFIG.beatsPerBar;
    const leftPx   = startBeat* SEQUENCER_CONFIG.pixelsPerBeat;
    const widthPx  = (endBeat- startBeat)* SEQUENCER_CONFIG.pixelsPerBeat;
    const sectionDiv= document.createElement("div");
    sectionDiv.className= "absolute top-0 border-l border-r border-gray-400 bg-gray-200 bg-opacity-30 text-gray-800 text-xs flex items-center pl-1";
    sectionDiv.style.left= leftPx+"px";
    sectionDiv.style.width= widthPx+"px";
    sectionDiv.style.height="20px";
    sectionDiv.textContent= sec.name;
    gridContent.appendChild(sectionDiv);
  });

  // notes display
  recordedNotes.forEach((note, idx)=>{
    const noteDiv= document.createElement("div");
    noteDiv.className= "absolute bg-blue-500 opacity-75 rounded cursor-pointer note-event";

    const startPx= note.startTime * (SEQUENCER_CONFIG.bpm/60)* SEQUENCER_CONFIG.pixelsPerBeat;
    const widthPx= note.duration * (SEQUENCER_CONFIG.bpm/60)* SEQUENCER_CONFIG.pixelsPerBeat;
    const topPx= note.noteIndex* SEQUENCER_CONFIG.noteHeight;

    noteDiv.style.left= startPx+"px";
    noteDiv.style.top= topPx+"px";
    noteDiv.style.width= widthPx+"px";
    noteDiv.style.height= SEQUENCER_CONFIG.noteHeight+"px";

    noteDiv.dataset.noteIdx= idx.toString();

    if(note.selected){
      noteDiv.classList.add("ring","ring-offset-2","ring-yellow-300");
    }

    // handles for resizing note left/right
    const leftHandle= document.createElement("div");
    leftHandle.className= "absolute left-0 top-0 bottom-0 w-2 bg-transparent cursor-w-resize";
    noteDiv.appendChild(leftHandle);

    const rightHandle= document.createElement("div");
    rightHandle.className= "absolute right-0 top-0 bottom-0 w-2 bg-transparent cursor-e-resize";
    noteDiv.appendChild(rightHandle);

    noteDiv.addEventListener("mousedown",(e)=>{
      e.stopPropagation();
      const rect= noteDiv.getBoundingClientRect();
      const offsetX= e.clientX - rect.left;

      draggingNote= note;
      dragStartX= e.clientX;
      dragStartY= e.clientY;
      dragOriginalStartTime= note.startTime;
      dragOriginalNoteIndex= note.noteIndex;
      resizingEdge= null;

      if(offsetX<5) {
        resizingEdge="left";
      } else if(offsetX> rect.width-5){
        resizingEdge="right";
      }
    });

    // single click => toggle selected state of note
    noteDiv.addEventListener("click",(e)=>{
      e.stopPropagation();
      if(!draggingNote) {
        note.selected= !note.selected;
        drawSequencerGrid();
      }
    });

    gridContent.appendChild(noteDiv);
  });
}

/******************************************************
* onmousemove => note dragging/resizing logic
******************************************************/
document.addEventListener("mousemove",(e)=>{
  if(!draggingNote) return;
  const dx= e.clientX- dragStartX;
  const secPerBeat= 60/ SEQUENCER_CONFIG.bpm;
  const pxPerSec  = SEQUENCER_CONFIG.pixelsPerBeat / secPerBeat;
  const dt= dx/ pxPerSec;

  if(resizingEdge){
    if(resizingEdge==="left"){
      const newStart= Math.max(dragOriginalStartTime+ dt, 0);
      const oldEnd= draggingNote.startTime+ draggingNote.duration;
      draggingNote.startTime= newStart;
      draggingNote.duration= oldEnd- newStart;
      if(draggingNote.duration< 0.05) draggingNote.duration= 0.05;
    } else {
      // right edge resize
      const newDur= draggingNote.duration+ dt;
      if(newDur>0.05){
        draggingNote.duration= newDur;
      }
    }
  } else {
    // moving the whole note horizontally/vertically
    const newStart= Math.max(dragOriginalStartTime+ dt,0);
    draggingNote.startTime= newStart;

    // vertical motion => new note row index (pitch)
    const dy= e.clientY- dragStartY;
    const rowChange= Math.round(dy/ SEQUENCER_CONFIG.noteHeight);
    let newIndex= dragOriginalNoteIndex+ rowChange;
    newIndex= Math.max(0, Math.min(newIndex, globalSortedNotes.length-1));
    draggingNote.noteIndex= newIndex;
    const newPitchObj = globalSortedNotes[newIndex];
    if(newPitchObj){
      const noteIdx = NOTES.indexOf(newPitchObj.noteName);
      const A4_OCT = 4;
      const A4_Idx = NOTES.indexOf("A");
      const pitch = (newPitchObj.octave - A4_OCT)*12 + (noteIdx - A4_Idx);

      draggingNote.noteName = newPitchObj.noteName;
      draggingNote.octave = newPitchObj.octave;
      draggingNote.pitch = pitch;
      draggingNote.x = newPitchObj.x;
      draggingNote.y = newPitchObj.y;
    }
  }
  drawSequencerGrid();
});

document.addEventListener("mouseup",()=>{
  if(draggingNote){
    pushHistory();
    draggingNote= null;
  }
  resizingEdge= null;
});

/******************************************************
* startNoteRecording(x,y):
* Called when a key is pressed in "record" mode.
******************************************************/
export function startNoteRecording(x,y) {
  if(!isRecording) return;
  const noteName= getNoteName(x,y);
  const octave  = getNoteOctave(x,y);
  const fullName= noteName+ octave;

  const noteIndex= globalNoteToIndexMap.get(fullName);
  if(noteIndex=== undefined) return;

  let now=0;
  if(isStepMode){
    now= stepModeTime;
  } else {
    initAudio();
    if(window.audioContext){
      now= window.audioContext.currentTime- audioStartTime;
    }
  }

  const noteIdx = NOTES.indexOf(noteName);
  const A4_OCT = 4;
  const A4_Idx = NOTES.indexOf("A");
  const pitch = (octave - A4_OCT)*12 + (noteIdx - A4_Idx);

  activeNotes.set(fullName, {
    noteName, octave, noteIndex, pitch,
    startTime: now, x, y, selected:false
  });
}

/******************************************************
* stopNoteRecording(x,y):
* Called when a key is released in "record" mode.
******************************************************/
export function stopNoteRecording(x,y) {
  if(!isRecording) return;
  const noteName= getNoteName(x,y);
  const octave  = getNoteOctave(x,y);
  const fullName= noteName+ octave;

  if(!activeNotes.has(fullName)) return;

  let now=0;
  if(isStepMode){
    now= stepModeTime;
  } else {
    initAudio();
    if(window.audioContext){
      now= window.audioContext.currentTime- audioStartTime;
    }
  }

  const act= activeNotes.get(fullName);
  let dur= now- act.startTime;
  if(isStepMode && dur<=0){
    dur= 60/ SEQUENCER_CONFIG.bpm;
  }

  recordedNotes.push({
    ...act,
    duration: dur,
    isPlaying:false,
    oscObj:null
  });
  activeNotes.delete(fullName);

  pushHistory();
  drawSequencerGrid();
}

/******************************************************
* stopPlayback():
******************************************************/
export function stopPlayback() {
  isPlaying= false;
  isRecording= false;
  const recInd= document.getElementById("record-indicator");
  if(recInd) recInd.classList.add("hidden");
  document.getElementById("play-btn")?.classList.remove("bg-green-600");
  document.getElementById("record-btn")?.classList.remove("bg-red-600");
  const playhead= document.getElementById("playhead");
  if(playhead) playhead.style.left="0";
  playheadPosition=0;

  // stop all playing notes
  recordedNotes.forEach(n=>{
    if(n.isPlaying && n.oscObj){
      stopOscillator(n.oscObj);
      n.oscObj= null;
      n.isPlaying= false;
      keysState[n.y][n.x].sequencerPlaying= false;
    }
  });
  drawTablature();

  // If metronome was on, stop scheduling so it doesn't beep while stopped
  stopMetronomeScheduling();
}

/******************************************************
* startPlayback():
******************************************************/
export async function startPlayback() {
  await initAudio();
  if(!window.audioContext){
    alert("AudioContext not available. Cannot play.");
    return;
  }
  isPlaying= true;
  audioStartTime= window.audioContext.currentTime;
  currentBeat=0;
  document.getElementById("play-btn")?.classList.add("bg-green-600");
  updatePlayhead();

  // If metronome was toggled on before pressing play, start scheduling now:
  if(metronomeIsOn) {
    startMetronomeScheduling();
  }
}

/******************************************************
* updatePlayhead():
* Called via requestAnimationFrame while playing.
******************************************************/
async function updatePlayhead() {
  let now=0;
  if(isStepMode){
    now= stepModeTime;
  } else {
    if(!isPlaying || !window.audioContext) {
      return;
    }
    now= window.audioContext.currentTime - audioStartTime;
  }

  const barInput= document.getElementById("barInput");
  const beatInput= document.getElementById("beatInput");
  const totalBeats= now*(SEQUENCER_CONFIG.bpm/60);
  const bar= Math.floor(totalBeats/ SEQUENCER_CONFIG.beatsPerBar)+1;
  const beat= (totalBeats % SEQUENCER_CONFIG.beatsPerBar)+1;
  if(barInput && beatInput){
    barInput.value= bar.toString();
    beatInput.value= beat.toFixed(2);
  }

  playheadPosition= totalBeats* SEQUENCER_CONFIG.pixelsPerBeat;
  const playhead= document.getElementById("playhead");
  if(playhead){
    playhead.style.left= playheadPosition+"px";
  }

  // schedule notes that should be playing now, stop notes that ended, etc.
  if(isPlaying && !isStepMode){
    for (const note of recordedNotes) {
      const start= note.startTime;
      const end= start+ note.duration;
      if(now>=start && now< end){
        if(!note.isPlaying){
          note.isPlaying= true;
          let freq= noteToFrequency(note.noteName, note.octave);
          if(pitchMappings[note.pitch]){
            // If pitchMappings override the note freq somehow:
            const mapped= pitchMappings[note.pitch];
            freq= noteToFrequency(mapped.noteName, mapped.octave);
          }
          const osc= await createOscillator(freq, currentInstrument);
          note.oscObj= osc;
          keysState[note.y][note.x].sequencerPlaying= true;
          drawTablature();
        }
      } else if(now>=end && note.isPlaying){
        note.isPlaying= false;
        if(note.oscObj){
          stopOscillator(note.oscObj);
          note.oscObj= null;
        }
        if(fadeNotes){
          keysState[note.y][note.x].sequencerPlaying= false;
          keysState[note.y][note.x].fading= true;
          keysState[note.y][note.x].fadeOutStart= performance.now();
        } else {
          keysState[note.y][note.x].sequencerPlaying= false;
        }
        drawTablature();
      }
    }
    requestAnimationFrame(updatePlayhead);
  } else if(isPlaying){
    // step mode - you can adapt as needed
    requestAnimationFrame(updatePlayhead);
  }
}

/******************************************************
* jumpToTime(seconds):
******************************************************/
export function jumpToTime(sec) {
  recordedNotes.forEach(n=>{
    if(n.isPlaying && n.oscObj){
      stopOscillator(n.oscObj);
      n.oscObj= null;
      n.isPlaying= false;
      keysState[n.y][n.x].sequencerPlaying= false;
    }
  });
  drawTablature();
  if(isStepMode){
    stepModeTime= sec;
  } else {
    initAudio();
    if(window.audioContext){
      const now= window.audioContext.currentTime;
      audioStartTime= now- sec;
    }
  }
  updateBarBeatDisplay(sec);
  updatePlayhead();

  // re-sync metronome so it doesn't drift if user jumps
  if(metronomeIsOn && isPlaying && window.audioContext) {
    nextMetronomeTime = window.audioContext.currentTime;
  }
}

function updateBarBeatDisplay(sec) {
  const totalBeats= sec*(SEQUENCER_CONFIG.bpm/60);
  const bar= Math.floor(totalBeats/ SEQUENCER_CONFIG.beatsPerBar)+1;
  const beat= (totalBeats % SEQUENCER_CONFIG.beatsPerBar)+1;

  const barInp= document.getElementById("barInput");
  const beatInp= document.getElementById("beatInput");
  if(barInp && beatInp){
    barInp.value= bar.toString();
    beatInp.value= beat.toFixed(2);
  }
}

export function jumpToPosition(barString, beatString) {
  const bar= parseFloat(barString)||1;
  const beat= parseFloat(beatString)||1;
  const totalB= (bar-1)* SEQUENCER_CONFIG.beatsPerBar + (beat-1);
  const sec= totalB*(60/ SEQUENCER_CONFIG.bpm);
  jumpToTime(sec);
}

/******************************************************
* pushHistory():
******************************************************/
export function pushHistory() {
  const snap= JSON.parse(JSON.stringify(recordedNotes));
  undoStack.push(snap);
  redoStack= [];
}

/******************************************************
* undo():
******************************************************/
export function undo() {
  if(!undoStack.length) return;
  const current= JSON.parse(JSON.stringify(recordedNotes));
  redoStack.push(current);
  const prev= undoStack.pop();
  recordedNotes= prev;
  drawSequencerGrid();
}

/******************************************************
* redo():
******************************************************/
export function redo() {
  if(!redoStack.length) return;
  const current= JSON.parse(JSON.stringify(recordedNotes));
  undoStack.push(current);
  const next= redoStack.pop();
  recordedNotes= next;
  drawSequencerGrid();
}

/******************************************************
* deleteSelectedNotes():
******************************************************/
export function deleteSelectedNotes() {
  const oldLen= recordedNotes.length;
  recordedNotes= recordedNotes.filter(n=> !n.selected);
  if(recordedNotes.length!== oldLen){
    pushHistory();
    drawSequencerGrid();
  }
}

/******************************************************
* addSection():
******************************************************/
export function addSection() {
  const startBar= parseInt(prompt("Enter start bar:", "1"),10);
  const endBar= parseInt(prompt("Enter end bar:", "2"),10);
  const name= prompt("Enter section name:", "Intro");
  if(isNaN(startBar)|| isNaN(endBar)|| !name){
    alert("Invalid section data.");
    return;
  }
  sequencerSections.push({ startBar, endBar, name });
  drawSequencerGrid();
}

/******************************************************
* toggleStepMode():
******************************************************/
export function toggleStepMode() {
  isStepMode= !isStepMode;
}

/******************************************************
* setSequencerBPM(newBPM):
******************************************************/
export function setSequencerBPM(newBPM) {
  SEQUENCER_CONFIG.bpm= newBPM;
  // also adjust nextMetronomeTime if metronome is on and playing
  if(metronomeIsOn && isPlaying && window.audioContext) {
    nextMetronomeTime = window.audioContext.currentTime;
  }
}

/******************************************************
* loadSequence():
******************************************************/
export function loadSequence() {
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
        const notes = Array.isArray(data) ? data : data.notes;
        if (!notes || !Array.isArray(notes)) {
          throw new Error("Invalid sequence file format");
        }

        buildSortedNotesMapping();

        const processedNotes = notes.map(note => {
          const fullName = note.noteName + note.octave;
          const noteIndex = globalNoteToIndexMap.get(fullName);

          const noteIdx = NOTES.indexOf(note.noteName);
          const A4_OCT = 4;
          const A4_Idx = NOTES.indexOf("A");
          const pitch = (note.octave - A4_OCT)*12 + (noteIdx - A4_Idx);

          return {
            ...note,
            noteIndex,
            pitch,
            isPlaying: false,
            oscObj: null,
            selected: false
          };
        });

        if (data.bpm) {
          setSequencerBPM(data.bpm);
          const tempoSlider = document.getElementById("tempoSlider");
          const tempoValue = document.getElementById("tempoValue");
          if (tempoSlider && tempoValue) {
            tempoSlider.value = data.bpm;
            tempoValue.textContent = `${data.bpm} BPM`;
          }
        }

        stopPlayback();

        recordedNotes.splice(0, recordedNotes.length, ...processedNotes);
        undoStack = [];
        redoStack = [];

        drawPianoRoll();
        drawSequencerGrid();

      } catch (err) {
        alert("Error loading sequence: " + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/******************************************************
* startRecording(), stopRecording() => optional helpers
******************************************************/
export async function startRecording() {
  if (isPlaying) {
    stopPlayback();
  }
  isRecording = true;
  isPlaying = true;
  await initAudio();
  if (!window.audioContext) {
    alert("AudioContext not available. Cannot record.");
    return;
  }
  audioStartTime = window.audioContext.currentTime;
  currentBeat = 0;
  const recInd = document.getElementById("record-indicator");
  if (recInd) recInd.classList.remove("hidden");
  document.getElementById("record-btn")?.classList.add("bg-red-600");
  updatePlayhead();

  // If metronome was toggled on, start scheduling
  if(metronomeIsOn) {
    startMetronomeScheduling();
  }
}

export function stopRecording() {
  isRecording = false;
  const recInd = document.getElementById("record-indicator");
  if (recInd) recInd.classList.add("hidden");
  document.getElementById("record-btn")?.classList.remove("bg-red-600");
  stopPlayback();
}

/******************************************************
* Extra: allow clicking in the sequencer grid to jump
******************************************************/
const sequencerGridEl = document.getElementById("sequencer-grid");
if(sequencerGridEl){
  sequencerGridEl.addEventListener("click", (e)=>{
    if(!isPlaying && !isStepMode) return; 
    // if you want to allow jumping even while stopped, remove the above check

    const rect= sequencerGridEl.getBoundingClientRect();
    // add any horizontal scroll offset if needed:
    const x= e.clientX - rect.left + sequencerGridEl.scrollLeft;
    const timeInSec= x / (SEQUENCER_CONFIG.pixelsPerBeat*(SEQUENCER_CONFIG.bpm/60));
    jumpToTime(timeInSec);
  });
}
