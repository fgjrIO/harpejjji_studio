import {
    keysState,
    numberOfFrets,
    numberOfStrings,
    currentModel,
    showNotes
  } from "./globals.js";
  import { drawTablature } from "./tablature.js";
  import { populateLibrary } from "./library.js";
  
  /**
   * Saves the current tablature (keysState, etc.) into localStorage 
   * (under "harpejjiSelections") and also downloads a .json file.
   */
  export function saveSelection() {
    const fileName = prompt("Enter a name for your tab:", "My Tab");
    if (!fileName) return;
  
    // Collect a simple list of note names for convenience (optional)
    const plainTextNotes = [];
    for (let y = 0; y < numberOfFrets; y++) {
      for (let x = 0; x < numberOfStrings; x++) {
        if (keysState[y][x].marker) {
          // We'll extract a textual note representation, like "C#3"
          // Optionally, you could store string/fret as well.
          const noteInfo = getNoteNameOctave(x, y);
          plainTextNotes.push(noteInfo);
        }
      }
    }
  
    // Build an SVG snapshot (vector) of the current tablature for a nice image thumbnail
    const svg = document.getElementById("tablature");
    let svgBase64 = "";
    if (svg) {
      const svgData = new XMLSerializer().serializeToString(svg);
      svgBase64 = "data:image/svg+xml;base64," + btoa(svgData);
    }
  
    // Prepare the data object
    const data = {
      type: "tab",
      name: fileName,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString(),
      model: document.getElementById("modelSelect")?.value || "K24", 
      keysState: keysState,
      image: svgBase64,
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
  
    // Save to localStorage library
    const savedSelections = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
    savedSelections.push(data);
    localStorage.setItem("harpejjiSelections", JSON.stringify(savedSelections));
  
    // Download as .json
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName + ".json";
    a.click();
    URL.revokeObjectURL(url);
  
    // Refresh library UI if open
    populateLibrary();
  }
  
  /**
   * Utility function to get a short "C#3" type of string for a key. 
   * (Similar logic to what we do in tablature, but we keep it local here.)
   */
  function getNoteNameOctave(x, y) {
    // We'll re-implement a simpler approach: 
    // "BASE_NOTE" from currentModel is stored in the modelData, 
    // but let's just read from DOM or from currentModel:
  
    // We can do a small helper that replicates your original getNoteName / getNoteOctave logic:
    const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const baseNoteIndex = NOTES.indexOf(currentModel.startNote); 
    const semitones = (x * 2) + (y * 1);
    const noteIndex = mod(baseNoteIndex + semitones, 12);
    const noteName = NOTES[noteIndex];
    // Octave offset
    const totalSemis = baseNoteIndex + semitones;
    const octaveShift = Math.floor(totalSemis / 12);
    const octave = currentModel.startOctave + octaveShift;
    return noteName + octave;
  }
  
  function mod(n, m) {
    return ((n % m) + m) % m;
  }
  