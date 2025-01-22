import { appState } from './state.js';
import { audioEngine } from './audio.js';
import { createSVGElement, isBlackNote } from './utils.js';
import { stringSpacing, keyHeight, loadedScales, NOTES } from './config.js';

class TablatureRenderer {
  constructor() {
    this.svg = null;
    this.onKeyDown = null;
    this.onKeyUp = null;
  }

  init(svgElement, { onKeyDown, onKeyUp }) {
    this.svg = svgElement;
    this.onKeyDown = onKeyDown;
    this.onKeyUp = onKeyUp;
  }

  getScaleSemitones(scaleName, rootNote) {
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

  draw() {
    if (!this.svg) return;

    const totalWidth = (appState.numberOfStrings * stringSpacing) + stringSpacing + 10;
    const totalHeight = (appState.numberOfFrets * appState.fretSpacing) + keyHeight + appState.fretSpacing/2 + 10;
    
    this.svg.setAttribute("width", totalWidth);
    this.svg.setAttribute("height", totalHeight);
    this.svg.innerHTML = "";

    // Background
    const bg = createSVGElement("rect", {
      width: "100%",
      height: "100%",
      fill: "white"
    });
    this.svg.appendChild(bg);

    const g = createSVGElement("g");
    this.svg.appendChild(g);

    // Draw grid lines
    this.drawGridLines(g, totalWidth, totalHeight);
    
    // Draw border
    this.drawBorder(g, totalWidth, totalHeight);

    // Draw keys
    this.drawKeys(g, totalHeight);
  }

  drawGridLines(g, totalWidth, totalHeight) {
    // Horizontal fret lines
    for (let row = 0; row <= appState.numberOfFrets; row++) {
      const lineY = row * appState.fretSpacing + appState.fretSpacing/2;
      const line = createSVGElement("line", {
        x1: 0,
        y1: totalHeight - lineY,
        x2: appState.numberOfStrings * stringSpacing,
        y2: totalHeight - lineY,
        stroke: "#000",
        "stroke-width": "1"
      });
      g.appendChild(line);
    }

    // Vertical string lines
    for (let x = 0; x < appState.numberOfStrings; x++) {
      const lineX = x * stringSpacing + stringSpacing;
      const line = createSVGElement("line", {
        x1: lineX,
        y1: totalHeight - appState.fretSpacing/2 - keyHeight,
        x2: lineX,
        y2: appState.fretSpacing/2,
        stroke: "#CCC",
        "stroke-width": "1"
      });
      g.appendChild(line);
    }
  }

  drawBorder(g, totalWidth, totalHeight) {
    const borderRect = createSVGElement("rect", {
      x: 0.5,
      y: 0.5,
      width: totalWidth - 1,
      height: totalHeight - 1,
      fill: "transparent",
      stroke: "black",
      "stroke-width": "1"
    });
    g.appendChild(borderRect);
  }

  drawKeys(g, totalHeight) {
    const scaleSet = this.getScaleSemitones(appState.currentScale, appState.currentRoot);

    for (let y = 0; y < appState.numberOfFrets; y++) {
      for (let x = 0; x < appState.numberOfStrings; x++) {
        const noteName = appState.getNoteName(x, y);
        const octave = appState.getNoteOctave(x, y);
        const blackKey = isBlackNote(noteName);

        const noteIndex = NOTES.indexOf(noteName);
        const inScale = scaleSet.has(noteIndex);

        const yPos = totalHeight - ((y * appState.fretSpacing) + appState.fretSpacing/2) - keyHeight;
        const xPos = (x * stringSpacing) + stringSpacing - 7.5;
        
        const keyGroup = this.createKeyGroup(x, y, xPos, yPos, blackKey, inScale, noteName, octave);
        g.appendChild(keyGroup);
      }
    }
  }

  createKeyGroup(x, y, xPos, yPos, blackKey, inScale, noteName, octave) {
    const keyGroup = createSVGElement("g", {
      transform: `translate(${xPos}, ${yPos})`
    });

    const rect = createSVGElement("rect", {
      x: 0,
      y: 0,
      width: 15,
      height: keyHeight,
      stroke: "#666",
      "stroke-width": "1",
      fill: blackKey ? "#999" : "#FFF"
    });

    if (inScale) {
      const highlightRect = createSVGElement("rect", {
        x: 0,
        y: 0,
        width: 15,
        height: keyHeight,
        fill: appState.scaleHighlightColor,
        "fill-opacity": appState.scaleHighlightAlpha.toString()
      });
      keyGroup.appendChild(rect);
      keyGroup.appendChild(highlightRect);
    } else {
      keyGroup.appendChild(rect);
    }

    // C indicator
    if (noteName === "C") {
      const cIndicator = createSVGElement("rect", {
        x: 4,
        y: 18,
        width: 7,
        height: 3,
        fill: "none",
        stroke: "black",
        "stroke-width": "1"
      });
      keyGroup.appendChild(cIndicator);
    }

    const stateObj = appState.keysState[y][x];
    if (stateObj.marker || stateObj.pressing || stateObj.sequencerPlaying) {
      const circ = createSVGElement("circle", {
        cx: 7.5,
        cy: 12.5,
        r: 7,
        fill: "rgba(0, 153, 255, 0.8)"
      });
      keyGroup.appendChild(circ);
    }

    if (appState.showNotes) {
      const label = createSVGElement("text", {
        x: 7.5,
        y: 7,
        fill: blackKey ? "#EEE" : "#555",
        "font-size": "7",
        "font-family": "Helvetica, Arial, sans-serif",
        "text-anchor": "middle",
        "dominant-baseline": "middle"
      });
      label.textContent = noteName + octave;
      keyGroup.appendChild(label);
    }

    keyGroup.style.cursor = "pointer";
    let isPressed = false;
    keyGroup.addEventListener("mousedown", (e) => {
      e.preventDefault();
      isPressed = true;
      this.onKeyDown?.(x, y);
    });
    keyGroup.addEventListener("mouseup", (e) => {
      e.preventDefault();
      if (isPressed) {
        isPressed = false;
        this.onKeyUp?.(x, y);
      }
    });
    keyGroup.addEventListener("mouseleave", (e) => {
      e.preventDefault();
      if (isPressed) {
        isPressed = false;
        this.onKeyUp?.(x, y);
      }
    });

    return keyGroup;
  }
}

export const tablature = new TablatureRenderer();
