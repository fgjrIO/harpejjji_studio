/******************************************************
 * tablature.js
 *
 * Responsible for:
 *  - Drawing the tablature on <svg id="tablature">
 *  - Handling scale overlays (rect or star)
 *  - Handling user clicks for "toggle"/"press"
 *  - Fading logic for "press" mode
 *  - Shifting marked notes
 *  - Optional note labels if showNotes=true
 ******************************************************/

import {
    keysState,
    numberOfFrets,
    numberOfStrings,
    fretSpacing,
    stringSpacing,
    keyHeight,
  
    showNotes,
    currentScale,
    currentRoot,
    scaleHighlightColor,
    scaleHighlightAlpha,
    scaleHighlightMode,
    scaleOverlayType,
    starOverlayMode,
    starSize,
    fadeNotes,
    fadeTime,
    keyMode,
  
    BASE_NOTE,
    BASE_OCTAVE,
    blackKeyColor,
    fingerOverlayColor,
    highDensity,
  
    NOTES,
    mod,
    getSemitonesFromBase,
    getNoteName,
    getNoteOctave,
    isBlackNote,
    noteToFrequency
  } from "./globals.js";
  
  import {
    createOscillator,
    stopOscillator,
    activeUserOscillators
  } from "./audio.js";
  
  /******************************************************
   * We'll import chord & sequencer logic dynamically
   * to avoid circular dependencies.
   ******************************************************/
  function recordChordNoteIfNeeded(x, y) {
    import("./chordPalette.js").then(({ recordChordNoteIfNeeded }) => {
      recordChordNoteIfNeeded(x, y);
    });
  }
  function startSequencerNote(x, y) {
    import("./sequencer.js").then(({ startNoteRecording }) => {
      startNoteRecording(x, y);
    });
  }
  function stopSequencerNote(x, y) {
    import("./sequencer.js").then(({ stopNoteRecording }) => {
      stopNoteRecording(x, y);
    });
  }
  
  /******************************************************
   * getScaleSemitones(scaleName, rootNote):
   * A local helper for building pitch classes of the scale.
   ******************************************************/
  import { loadedScales } from "./globals.js";
  function getScaleSemitones(scaleName, rootNote) {
    if (!scaleName || scaleName==="none") return new Set();
    const intervals = loadedScales[scaleName];
    if (!intervals) return new Set();
  
    const rootIndex = NOTES.indexOf(rootNote);
    if (rootIndex < 0) return new Set();
  
    let pcs = new Set();
    let currentPos= 0;
    pcs.add(rootIndex%12);
    intervals.forEach(iv=>{
      currentPos+= iv;
      pcs.add((rootIndex+ currentPos)%12);
    });
    return pcs;
  }
  
  /******************************************************
   * star overlay generation
   ******************************************************/
  function generateStarPoints(cx, cy, outerRadius, innerRadius, numPoints=5) {
    const step= Math.PI/numPoints;
    let angle= Math.PI/2*3;
    const points= [];
    for (let i=0; i<numPoints; i++){
      const xOuter= cx + Math.cos(angle)* outerRadius;
      const yOuter= cy + Math.sin(angle)* outerRadius;
      points.push(`${xOuter},${yOuter}`);
      angle+= step;
  
      const xInner= cx + Math.cos(angle)* innerRadius;
      const yInner= cy + Math.sin(angle)* innerRadius;
      points.push(`${xInner},${yInner}`);
      angle+= step;
    }
    return points.join(" ");
  }
  
  /******************************************************
   * drawTablature():
   * Draws the entire board, scale overlays, markers, etc.
   ******************************************************/
  let animFrameRequested= false;
  
  export function drawTablature() {
    const svg = document.getElementById("tablature");
    if (!svg) return;
  
    const totalWidth= (numberOfStrings*stringSpacing)+ stringSpacing+ 10;
    const totalHeight= (numberOfFrets*fretSpacing)+ keyHeight+ (fretSpacing/2)+ 10;
    svg.setAttribute("width", totalWidth);
    svg.setAttribute("height", totalHeight);
    svg.innerHTML= "";
  
    // background
    const bg = document.createElementNS("http://www.w3.org/2000/svg","rect");
    bg.setAttribute("width","100%");
    bg.setAttribute("height","100%");
    bg.setAttribute("fill","white");
    svg.appendChild(bg);
  
    const g = document.createElementNS("http://www.w3.org/2000/svg","g");
    svg.appendChild(g);
  
    // horizontal lines
    for (let row=0; row<= numberOfFrets; row++){
      const lineY= row*fretSpacing + (fretSpacing/2);
      const line= document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1","0");
      line.setAttribute("y1", totalHeight-lineY);
      line.setAttribute("x2", numberOfStrings*stringSpacing);
      line.setAttribute("y2", totalHeight-lineY);
      line.setAttribute("stroke","#000");
      line.setAttribute("stroke-width","1");
      g.appendChild(line);
    }
  
    // vertical lines
    for (let x=0; x< numberOfStrings; x++){
      const lineX= x* stringSpacing+ stringSpacing;
      const line= document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1", lineX);
      line.setAttribute("y1", totalHeight-(fretSpacing/2)- keyHeight);
      line.setAttribute("x2", lineX);
      line.setAttribute("y2", fretSpacing/2);
      line.setAttribute("stroke","#CCC");
      line.setAttribute("stroke-width","1");
      g.appendChild(line);
    }
  
    // outer border
    const borderRect = document.createElementNS("http://www.w3.org/2000/svg","rect");
    borderRect.setAttribute("x","0.5");
    borderRect.setAttribute("y","0.5");
    borderRect.setAttribute("width", totalWidth-1);
    borderRect.setAttribute("height", totalHeight-1);
    borderRect.setAttribute("fill","transparent");
    borderRect.setAttribute("stroke","black");
    borderRect.setAttribute("stroke-width","1");
    g.appendChild(borderRect);
  
    // gather scale pitch classes
    const scaleSet = getScaleSemitones(currentScale, currentRoot);
    const now= performance.now();
    let stillFading= false;
  
    for (let y=0; y< numberOfFrets; y++){
      for (let x=0; x< numberOfStrings; x++){
        const noteName= getNoteName(x,y);
        const octave  = getNoteOctave(x,y);
        const blackKey= isBlackNote(noteName);
  
        const noteIndex= mod(NOTES.indexOf(noteName),12);
        const inScale= scaleSet.has(noteIndex);
  
        const yPos= totalHeight - ((y*fretSpacing)+ fretSpacing/2) - keyHeight;
        const xPos= x* stringSpacing + stringSpacing - 7.5;
        const keyGroup= document.createElementNS("http://www.w3.org/2000/svg","g");
        keyGroup.setAttribute("transform", `translate(${xPos},${yPos})`);
  
        // base rect
        const rect= document.createElementNS("http://www.w3.org/2000/svg","rect");
        rect.setAttribute("x","0");
        rect.setAttribute("y","0");
        rect.setAttribute("width","15");
        rect.setAttribute("height",keyHeight);
        rect.setAttribute("fill", blackKey? blackKeyColor : "#FFF");
        rect.setAttribute("stroke", highDensity ? "#000" : "#666");
        rect.setAttribute("stroke-width", highDensity ? "1.5" : "1");
        keyGroup.appendChild(rect);
  
        // scale overlay
        if(inScale){
          if(scaleOverlayType==="keys"){
            // fill / outline / both
            if(scaleHighlightMode==="fill"|| scaleHighlightMode==="both"){
              const fillRect= document.createElementNS("http://www.w3.org/2000/svg","rect");
              fillRect.setAttribute("x","0");
              fillRect.setAttribute("y","0");
              fillRect.setAttribute("width","15");
              fillRect.setAttribute("height", keyHeight);
              fillRect.setAttribute("fill", scaleHighlightColor);
              fillRect.setAttribute("fill-opacity", scaleHighlightAlpha.toString());
              keyGroup.appendChild(fillRect);
            }
            if(scaleHighlightMode==="outline"|| scaleHighlightMode==="both"){
              const outlineRect= document.createElementNS("http://www.w3.org/2000/svg","rect");
              outlineRect.setAttribute("x","0");
              outlineRect.setAttribute("y","0");
              outlineRect.setAttribute("width","15");
              outlineRect.setAttribute("height", keyHeight);
              outlineRect.setAttribute("fill","none");
              outlineRect.setAttribute("stroke", scaleHighlightColor);
              outlineRect.setAttribute("stroke-opacity", scaleHighlightAlpha.toString());
              outlineRect.setAttribute("stroke-width","2");
              keyGroup.appendChild(outlineRect);
            }
          } else if(scaleOverlayType==="star"){
            // star approach
            const cx= 7.5;
            const cy= keyHeight - (starSize/2);
            const starPoints= generateStarPoints(cx, cy, starSize/2, starSize/6);
            const starEl= document.createElementNS("http://www.w3.org/2000/svg","polygon");
            starEl.setAttribute("points", starPoints);
            if(starOverlayMode==="fill"|| starOverlayMode==="both"){
              starEl.setAttribute("fill", scaleHighlightColor);
              starEl.setAttribute("fill-opacity", scaleHighlightAlpha.toString());
            } else {
              starEl.setAttribute("fill","none");
            }
            if(starOverlayMode==="outline"|| starOverlayMode==="both"){
              starEl.setAttribute("stroke", scaleHighlightColor);
              starEl.setAttribute("stroke-opacity", scaleHighlightAlpha.toString());
              starEl.setAttribute("stroke-width","1.5");
            } else {
              starEl.setAttribute("stroke","none");
            }
            keyGroup.appendChild(starEl);
          }
        }
  
        // small rect near bottom if note is "C"
        if(noteName==="C"){
          const cRect = document.createElementNS("http://www.w3.org/2000/svg","rect");
          cRect.setAttribute("x","4");
          cRect.setAttribute("y","18");
          cRect.setAttribute("width","7");
          cRect.setAttribute("height","3");
          cRect.setAttribute("fill","none");
          cRect.setAttribute("stroke","black");
          cRect.setAttribute("stroke-width","1");
          keyGroup.appendChild(cRect);
        }
  
        // marker / press / fade circle
        const st= keysState[y][x];
        let drawCircle= false;
        let circleAlpha= 1;
        if(st.marker || st.pressing || st.sequencerPlaying){
          drawCircle= true;
        } else if(st.fading){
          const elapsed= (now - st.fadeOutStart)/1000;
          const ratio= 1-(elapsed/fadeTime);
          if(ratio>0){
            drawCircle= true;
            circleAlpha= ratio;
            stillFading= true;
          } else {
            st.fading= false;
            st.fadeOutStart= null;
          }
        }
  
        if(drawCircle){
          const circ= document.createElementNS("http://www.w3.org/2000/svg","circle");
          circ.setAttribute("cx","7.5");
          circ.setAttribute("cy","12.5");
          circ.setAttribute("r","7");
          circ.setAttribute("fill", `rgba(0,153,255,${circleAlpha.toFixed(2)})`);
          keyGroup.appendChild(circ);
  
          if(st.finger && circleAlpha>0.15){
            const fingerText= document.createElementNS("http://www.w3.org/2000/svg","text");
            fingerText.setAttribute("x","7.5");
            fingerText.setAttribute("y","13");
            fingerText.setAttribute("fill", fingerOverlayColor);
            fingerText.setAttribute("font-size","8");
            fingerText.setAttribute("font-family","Helvetica,Arial,sans-serif");
            fingerText.setAttribute("text-anchor","middle");
            fingerText.setAttribute("dominant-baseline","middle");
            fingerText.textContent= st.finger;
            keyGroup.appendChild(fingerText);
          }
        }
  
        // show note labels if requested
        if(showNotes){
          const label= document.createElementNS("http://www.w3.org/2000/svg","text");
          label.setAttribute("x","7.5");
          label.setAttribute("y","7");
          label.setAttribute("fill", blackKey? "#EEE":"#555");
          label.setAttribute("font-size","7");
          label.setAttribute("font-family","Helvetica,Arial,sans-serif");
          label.setAttribute("text-anchor","middle");
          label.setAttribute("dominant-baseline","middle");
          label.textContent= noteName + octave;
          keyGroup.appendChild(label);
        }
  
        keyGroup.style.cursor= "pointer";
        keyGroup.addEventListener("mousedown", ()=> handleKeyDown(x,y));
        keyGroup.addEventListener("mouseup", ()=> handleKeyUp(x,y));
  
        g.appendChild(keyGroup);
      }
    }
  
    if(stillFading){
      if(!animFrameRequested){
        animFrameRequested= true;
        requestAnimationFrame(()=>{
          animFrameRequested= false;
          drawTablature();
        });
      }
    }
  }
  
  /******************************************************
   * handleKeyDown(x,y):
   *  - Called on mouse down.
   ******************************************************/
export async function handleKeyDown(x,y) {
    const noteName= getNoteName(x,y);
    const octave  = getNoteOctave(x,y);
    const freq    = noteToFrequency(noteName, octave);
  
    const oscObj= await createOscillator(freq, window.currentInstrument || "piano");
    activeUserOscillators.set(`${x}_${y}`, oscObj);
  
    if(keyMode==="toggle"){
      const old= keysState[y][x].marker;
      keysState[y][x].marker= !old;
      if(keysState[y][x].marker){
        // finger assignment
        const fingerSel= document.getElementById("fingerSelect");
        if(fingerSel && fingerSel.value!=="None"){
          keysState[y][x].finger= fingerSel.value;
        }
      } else {
        keysState[y][x].finger= null;
      }
    } else {
      // "press" => pressing=true
      keysState[y][x].pressing= true;
      keysState[y][x].fading= false;
      keysState[y][x].fadeOutStart= null;
    }
  
    // chord record
    recordChordNoteIfNeeded(x,y);
  
    // sequencer record
    startSequencerNote(x,y);
  
    drawTablature();
  }
  
  /******************************************************
   * handleKeyUp(x,y):
   *  - Called on mouse up.
   ******************************************************/
  export function handleKeyUp(x,y){
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
  
    // stop chord record if needed?
    // Actually it's just "recordChordNoteIfNeeded" on down, no special up.
    // But for sequencer we do stop
    stopSequencerNote(x,y);
  
    drawTablature();
  }
  
  /******************************************************
   * shiftSelection(dx,dy):
   * Shift all marked keys by (dx,dy).
   ******************************************************/
  export function shiftSelection(dx,dy) {
    const selected= [];
    for(let fy=0; fy<numberOfFrets; fy++){
      for(let fx=0; fx<numberOfStrings; fx++){
        if(keysState[fy][fx].marker){
          selected.push({x:fx, y:fy});
        }
      }
    }
    selected.forEach(pos=>{
      const oldX= pos.x;
      const oldY= pos.y;
      const newX= oldX+ dx;
      const newY= oldY+ dy;
      if(newX>=0 && newX< numberOfStrings && newY>=0 && newY< numberOfFrets){
        keysState[oldY][oldX].marker= false;
        keysState[oldY][oldX].finger= null;
        keysState[oldY][oldX].fading= false;
        keysState[oldY][oldX].fadeOutStart= null;
        keysState[newY][newX].marker= true;
      }
    });
    drawTablature();
  }
  
  /******************************************************
   * playNoteTemporary(x,y, duration=300):
   * For "Play Selection" button, or quick beep of a note.
   ******************************************************/
  export async function playNoteTemporary(x,y, duration=300){
    const noteName= getNoteName(x,y);
    const octave= getNoteOctave(x,y);
    const freq= noteToFrequency(noteName, octave);
    const oscObj= await createOscillator(freq, window.currentInstrument || "piano");
    setTimeout(()=> {
      stopOscillator(oscObj);
    }, duration);
  }
