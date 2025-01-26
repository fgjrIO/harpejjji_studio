/******************************************************
 * chordPalette.js
 *
 * Manages:
 *  - 8 chord slots, each with {name, keys[]}
 *  - Recording notes into a chord slot (button "R")
 *  - Clearing chord notes (button "C")
 *  - Renaming (button "N")
 *  - Saving to file (button "S")
 *  - Sending chord to library (button "L")
 *  - Press/Toggle/Strum logic for playing chord
 ******************************************************/

import {
    keysState,
    getNoteName,
    getNoteOctave,
    noteToFrequency,
    numberOfFrets,
    numberOfStrings,
    keyMode,
    fadeNotes,
    currentInstrument,
    fretSpacing,
    stringSpacing,
    keyHeight
  } from "./globals.js";
  
  import { createOscillator, stopOscillator, activeUserOscillators } from "./audio.js";
  
  /**
   * The chordSlots array of 8 chord objects:
   *   { name: "Chord #", keys: [ { x, y, noteName, octave } ] }
   */
  export let chordSlots = Array(8).fill(null).map((_, i) => ({
    name: `Chord ${i+1}`,
    keys: []
  }));
  
  /**
   * chordRecordIndex => which chord slot is currently recording (-1 if none).
   */
  export let chordRecordIndex = -1;
  
  /******************************************************
   * toggleChordRecord(index):
   *   If chordRecordIndex is the same, set to -1 (off).
   *   Else set it to `index`.
   ******************************************************/
  export function toggleChordRecord(index) {
    chordRecordIndex = (chordRecordIndex === index) ? -1 : index;
    updateChordPaletteUI();
  }
  
  /******************************************************
   * clearChordNotes(index):
   *   Empties a chord slot.
   ******************************************************/
  export function clearChordNotes(index) {
    chordSlots[index].keys = [];
    updateChordPaletteUI();
  }
  
  /******************************************************
   * renameChordSlot(index):
   *   Prompt user for new name
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
   *   If chordRecordIndex>=0, add that note to the chord slot
   *   if not already present.
   ******************************************************/
  export function recordChordNoteIfNeeded(x, y) {
    if (chordRecordIndex === -1) return;
    const noteName = getNoteName(x, y);
    const octave   = getNoteOctave(x, y);
    const chord    = chordSlots[chordRecordIndex];
  
    const already = chord.keys.some(k => k.x===x && k.y===y);
    if (!already) {
      chord.keys.push({ x, y, noteName, octave });
      updateChordPaletteUI();
    }
  }
  
  /******************************************************
   * setChordNotesFromKeysState(index):
   *   Overwrite chord slot from whichever keys are marked.
   ******************************************************/
  export function setChordNotesFromKeysState(index) {
    const chord = chordSlots[index];
    chord.keys = [];
    for (let fy=0; fy<numberOfFrets; fy++){
      for (let fx=0; fx<numberOfStrings; fx++){
        if(keysState[fy][fx].marker){
          chord.keys.push({
            x: fx, y: fy,
            noteName: getNoteName(fx, fy),
            octave: getNoteOctave(fx, fy)
          });
        }
      }
    }
    updateChordPaletteUI();
  }
  
  /******************************************************
   * chordPressDown(index):
   *   If chordMode="press" and keyMode="press", 
   *   we press & hold all notes until chordPressUp().
   ******************************************************/
  export async function chordPressDown(index) {
    const chord = chordSlots[index];
    for (const k of chord.keys) {
      await handleKeyDownProgrammatically(k.x, k.y);
    }
  }
  export function chordPressUp(index) {
    const chord = chordSlots[index];
    chord.keys.forEach(k => {
      handleKeyUpProgrammatically(k.x, k.y);
    });
  }
  
  /******************************************************
   * chordToggle(index):
   *   If chordMode="press" but keyMode="toggle",
   *   we do a quick press & release each note with a short delay.
   ******************************************************/
  export async function chordToggle(index) {
    const chord = chordSlots[index];
    for (const k of chord.keys) {
      await handleKeyDownProgrammatically(k.x, k.y);
      setTimeout(() => {
        handleKeyUpProgrammatically(k.x, k.y);
      }, 300);
    }
  }
  
  /******************************************************
   * chordStrum(index, delayMs):
   *   Sort chord keys left->right, press them one at a time.
   ******************************************************/
  export async function chordStrum(index, delayMs=100) {
    const chord = chordSlots[index];
    // sort by ascending x, then y
    const sorted = chord.keys.slice().sort((a,b) => (a.x - b.x) || (a.y - b.y));
  
    for (const k of sorted) {
      await handleKeyDownProgrammatically(k.x, k.y);
      setTimeout(() => {
        handleKeyUpProgrammatically(k.x, k.y);
      }, 300);
      if (sorted.indexOf(k) < sorted.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  /******************************************************
   * clearAllTabMarkers():
   *   Clears all "marker", "pressing", etc. from keysState.
   ******************************************************/
  export function clearAllTabMarkers() {
    for (let fy=0; fy<numberOfFrets; fy++){
      for (let fx=0; fx<numberOfStrings; fx++){
        keysState[fy][fx].marker= false;
        keysState[fy][fx].pressing= false;
        keysState[fy][fx].finger= null;
        keysState[fy][fx].fading= false;
        keysState[fy][fx].fadeOutStart= null;
      }
    }
    // call drawTablature via dynamic import
    import("./tablature.js").then(({ drawTablature }) => {
      drawTablature();
    });
  }
  
  /******************************************************
   * handleKeyDownProgrammatically(x, y):
   *   Press a key as if user clicked it. (Used for chord triggers.)
   ******************************************************/
async function handleKeyDownProgrammatically(x, y) {
  const noteName= getNoteName(x,y);
  const octave  = getNoteOctave(x,y);
  const freq    = noteToFrequency(noteName, octave);

  const oscObj= await createOscillator(freq, currentInstrument);
  activeUserOscillators.set(`${x}_${y}`, oscObj);
  
    if(keyMode==="toggle"){
      const old= keysState[y][x].marker;
      keysState[y][x].marker= !old;
      if(keysState[y][x].marker){
        // finger?
        const fingerSel= document.getElementById("fingerSelect");
        if(fingerSel && fingerSel.value!=="None"){
          keysState[y][x].finger= fingerSel.value;
        }
      } else {
        keysState[y][x].finger= null;
      }
    } else {
      // press mode
      keysState[y][x].pressing= true;
      keysState[y][x].fading= false;
      keysState[y][x].fadeOutStart= null;
    }
  
    // chord record
    recordChordNoteIfNeeded(x,y);
  
    // sequencer record
    import("./sequencer.js").then(({ startNoteRecording }) => {
      startNoteRecording(x, y);
    });
  
    // re-draw
    import("./tablature.js").then(({ drawTablature }) => {
      drawTablature();
    });
  }
  
  /******************************************************
   * handleKeyUpProgrammatically(x, y):
   *   Release a key as if user mouseup.
   ******************************************************/
  function handleKeyUpProgrammatically(x, y){
    const keyStr= `${x}_${y}`;
    if(activeUserOscillators.has(keyStr)){
      stopOscillator(activeUserOscillators.get(keyStr));
      activeUserOscillators.delete(keyStr);
    }
  
    if(keyMode==="press"){
      if(fadeNotes){
        keysState[y][x].pressing= false;
        keysState[y][x].fading= true;
        keysState[y][x].fadeOutStart= performance.now();
      } else {
        keysState[y][x].pressing= false;
      }
    }
  
    // stop sequencer note
    import("./sequencer.js").then(({ stopNoteRecording }) => {
      stopNoteRecording(x, y);
    });
  
    import("./tablature.js").then(({ drawTablature }) => {
      drawTablature();
    });
  }
  
  /******************************************************
   * updateChordPaletteUI():
   *   Refreshes the chord slot UI elements, e.g. 
   *   highlight record button, update chord names on button text.
   ******************************************************/
  export function updateChordPaletteUI() {
    const recordBtns = document.querySelectorAll(".chord-record-btn");
    recordBtns.forEach(btn=>{
      const idx= parseInt(btn.getAttribute("data-chord-index"),10);
      if(idx=== chordRecordIndex){
        btn.classList.add("ring","ring-offset-2","ring-red-500");
      } else {
        btn.classList.remove("ring","ring-offset-2","ring-red-500");
      }
    });
  
    const chordButtons= document.querySelectorAll(".chord-button");
    chordButtons.forEach(btn=>{
      const slotDiv= btn.closest(".chord-slot");
      const idx= parseInt(slotDiv.getAttribute("data-chord-index"),10);
      btn.textContent= chordSlots[idx].name;
    });
  }
  
  /******************************************************
   * saveChordToFile(index):
   *   Exports chord data => .json file
   ******************************************************/
  export function saveChordToFile(index) {
    const chord= chordSlots[index];
    if(!chord.keys.length){
      alert("Cannot save an empty chord.");
      return;
    }
    const chordName= prompt("Enter name for this chord:", chord.name);
    if(!chordName) return;
  
    const data= {
      type: "chord",
      name: chordName,
      keys: chord.keys.map(k => ({
        x: k.x, y: k.y, 
        noteName: k.noteName, 
        octave: k.octave
      })),
      timestamp: new Date().toISOString()
    };
  
    const blob= new Blob([JSON.stringify(data,null,2)], {type:"application/json"});
    const url= URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href= url;
    a.download= chordName + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
  
  /******************************************************
   * sendChordToLibrary(index):
   *   Adds chord to localStorage library, capturing 
   *   an optional bounding-box snippet from the tablature.
   ******************************************************/
  export function sendChordToLibrary(index) {
    const chord= chordSlots[index];
    if(!chord.keys.length){
      alert("Cannot send an empty chord to library.");
      return;
    }
    const chordName= prompt("Enter a name for this chord:", chord.name);
    if(!chordName) return;
  
    chordSlots[index].name= chordName;
  
    const chordImage= captureChordImage(chord) || null;
  
    const data= {
      type: "chord",
      name: chordName,
      keys: chord.keys.map(k =>({
        x: k.x, y: k.y,
        noteName: k.noteName,
        octave: k.octave
      })),
      timestamp: new Date().toISOString(),
      model: document.getElementById("modelSelect")?.value || null,
      image: chordImage
    };
  
    const saved= JSON.parse(localStorage.getItem("harpejjiSelections")||"[]");
    saved.push(data);
    localStorage.setItem("harpejjiSelections", JSON.stringify(saved));
  
    // refresh library
    import("./library.js").then(({ populateLibrary })=>{
      populateLibrary();
    });
  }
  
  /******************************************************
   * captureChordImage(chord):
   *   Takes bounding-box of chord keys from <svg id="tablature">
   *   => base64 SVG snippet
   ******************************************************/
  function captureChordImage(chord) {
    if(!chord.keys || !chord.keys.length) return null;
    let minX= Math.min(...chord.keys.map(k=>k.x));
    let maxX= Math.max(...chord.keys.map(k=>k.x));
    let minY= Math.min(...chord.keys.map(k=>k.y));
    let maxY= Math.max(...chord.keys.map(k=>k.y));
  
    // expand bounding box by 2
    minX= Math.max(0, minX-2);
    maxX= Math.min(numberOfStrings-1, maxX+2);
    minY= Math.max(0, minY-2);
    maxY= Math.min(numberOfFrets-1, maxY+2);
  
    const svg = document.getElementById("tablature");
    if(!svg) return null;
  
    const totalWidth = parseFloat(svg.getAttribute("width"))||0;
    const totalHeight= parseFloat(svg.getAttribute("height"))||0;
  
    // convert row->y coords
    const yTop = totalHeight - ((maxY * fretSpacing) + fretSpacing/2) - keyHeight;
    const yBottom = totalHeight - ((minY * fretSpacing) + fretSpacing/2);
    const chordHeight = yBottom - yTop;
  
    const xLeft = (minX * stringSpacing) + stringSpacing - 7.5;
    const xRight = (maxX * stringSpacing) + stringSpacing + 7.5;
    const chordWidth= xRight- xLeft;
  
    const cloned= svg.cloneNode(true);
    cloned.setAttribute("viewBox", `${xLeft} ${yTop} ${chordWidth} ${chordHeight}`);
    cloned.setAttribute("width", chordWidth);
    cloned.setAttribute("height", chordHeight);
  
    const svgData= new XMLSerializer().serializeToString(cloned);
    return "data:image/svg+xml;base64,"+ btoa(svgData);
  }
