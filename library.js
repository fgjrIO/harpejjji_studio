/******************************************************
 * library.js
 *
 * Manages:
 *  - LocalStorage-based library of tab/chord items
 *  - Toggling the library side panel (#librarySlideover)
 *  - Filtering by type, scale, model
 *  - Loading a selection (tab or chord) back into the app
 *  - Printing, importing, exporting
 *  - "Wide Mode" toggle => expands the white panel to half the screen
 *  - 4×4 grid layout with pagination
 *  - "Chord Tool" for batch row/col shifting
 ******************************************************/

import {
  currentScale,
  currentRoot,
  NOTES,
  MODELS,
  currentModel,
  numberOfStrings,
  numberOfFrets,
  BASE_NOTE,
  BASE_OCTAVE,
  initKeysState,
  keysState,
  setCurrentModel,
  loadedScales,
  noteToFrequency
} from "./globals.js";

import { drawTablature } from "./tablature.js";
import { drawPianoRoll, drawSequencerGrid } from "./sequencer.js";
import { chordSlots } from "./chordPalette.js";
import { createOscillator, stopOscillator } from "./audio.js";
import { captureChordImage } from "./chordPalette.js";

/******************************************************
 * Global pagination & wide mode states
 ******************************************************/
let libraryPageIndex = 0;    // Which page we're on
const itemsPerPage = 16;     // 4x4 grid
let wideModeEnabled = false; // toggled by handleWideModeToggle()

/******************************************************
 * We'll keep a reference to whichever chord the user
 * wants to apply the "Chord Tool" to.
 ******************************************************/
let chordToolSourceChord = null; 

/******************************************************
 * toggleLibrary():
 *  - Show/hide the library side panel (#librarySlideover)
 ******************************************************/
export function toggleLibrary() {
  const slideover = document.getElementById("librarySlideover");
  if (!slideover) return;
  slideover.classList.toggle("hidden");
}

/******************************************************
 * handleWideModeToggle(enabled):
 *  - Called when user checks/unchecks "Wide Mode" in index.html
 ******************************************************/
export function handleWideModeToggle(enabled) {
  wideModeEnabled = enabled;
  libraryPageIndex = 0; // reset pagination back to first page
  populateLibrary();
}

/******************************************************
 * populateLibrary():
 *  - Filter, paginate, and display items. 
 *  - If wideModeEnabled, expand the white panel to half-screen
 *    and show items in a 4x4 grid with pagination.
 ******************************************************/
export function populateLibrary() {
  const slideover = document.getElementById("librarySlideover");
  if (!slideover) return;

  // The white library panel
  const libraryPanel = slideover.querySelector("div.absolute.left-0.top-0.bottom-0.bg-white");
  if (libraryPanel) {
    if (wideModeEnabled) {
      libraryPanel.classList.remove("w-72");
      libraryPanel.classList.add("w-[50vw]");
    } else {
      libraryPanel.classList.remove("w-[50vw]");
      libraryPanel.classList.add("w-72");
    }
  }

  const libraryContent = document.getElementById("libraryContent");
  if (!libraryContent) return;

  libraryContent.innerHTML = "";

  const savedSelections = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
  if (!savedSelections.length) {
    libraryContent.innerHTML = '<p class="text-gray-500 text-center">No saved selections yet</p>';
    return;
  }

  // Read filters
  const scaleFilterCheckbox = document.getElementById("scaleFilterCheckbox");
  const libraryFilterRadios = document.querySelectorAll('input[name="libraryFilter"]');
  const libraryFilterVal =
    Array.from(libraryFilterRadios).find(radio => radio.checked)?.value || "all";
  const modelFilterSel = document.getElementById("modelFilterSelect");
  const modelFilterVal = modelFilterSel?.value || "all";

  const doScaleFilter = scaleFilterCheckbox && scaleFilterCheckbox.checked && currentScale !== "none";

  // Filter the entire array
  const filtered = savedSelections.filter((selection) => {
    // Type filter (tabs vs chords vs all)
    if (libraryFilterVal !== "all") {
      const wantType = (libraryFilterVal === "tabs") ? "tab" : "chord";
      if (selection.type !== wantType) return false;
    }

    // Model filter
    if (modelFilterVal !== "all" && modelFilterVal) {
      if (!selection.model || selection.model !== modelFilterVal) return false;
    }

    // Scale filter
    if (doScaleFilter) {
      if (selection.type === "tab") {
        if (!allNotesInCurrentScale(selection.notesPlainText)) return false;
      } else if (selection.type === "chord") {
        if (!allChordNotesInCurrentScale(selection.keys)) return false;
      }
    }

    return true;
  });

  if (!filtered.length) {
    libraryContent.innerHTML = '<p class="text-gray-500 text-center">No items match your filter</p>';
    return;
  }

  // PAGINATION
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  if (libraryPageIndex >= totalPages) libraryPageIndex = totalPages - 1;
  if (libraryPageIndex < 0) libraryPageIndex = 0;
  const start = libraryPageIndex * itemsPerPage;
  const end = start + itemsPerPage;
  const pageItems = filtered.slice(start, end);

  // If wideMode => 4x4 grid
  if (wideModeEnabled) {
    libraryContent.classList.remove("space-y-4");
    libraryContent.classList.add("grid", "grid-cols-4", "gap-4");
  } else {
    libraryContent.classList.remove("grid", "grid-cols-4", "gap-4");
    libraryContent.classList.add("space-y-4");
  }

  // Build each item
  pageItems.forEach((selection) => {
    const div = document.createElement("div");
    div.className = "relative p-2 border rounded hover:bg-gray-100";

    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "absolute top-2 right-2 px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 text-xs";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSelectionByObject(selection);
    });
    div.appendChild(deleteBtn);

    // Preview button
    const previewBtn = document.createElement("button");
    previewBtn.className = "absolute top-2 right-16 px-2 py-1 rounded bg-emerald-500 text-white hover:bg-emerald-600 text-xs";
    previewBtn.textContent = "Preview";
    previewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      previewItem(selection);
    });
    div.appendChild(previewBtn);

    // If it's a chord, add a "Chord Tool" button
    if (selection.type === "chord") {
      const chordToolBtn = document.createElement("button");
      chordToolBtn.className = "absolute top-2 left-2 px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 text-xs";
      chordToolBtn.textContent = "Chord Tool";
      chordToolBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openChordToolPopup(selection);
      });
      div.appendChild(chordToolBtn);
    }

    // Content => load
    const contentDiv = document.createElement("div");
    contentDiv.className = "cursor-pointer selection-content";
    div.appendChild(contentDiv);

    // Image
    if (selection.image) {
      const img = document.createElement("img");
      img.src = selection.image;
      img.alt = selection.name;
      img.className = "w-full h-32 object-contain mb-2 bg-white";
      contentDiv.appendChild(img);
    }

    // Basic info
    const infoDiv = document.createElement("div");
    infoDiv.className = "text-sm text-center";
    infoDiv.innerHTML = `
      <span class="block font-bold">${selection.name}</span>
      <span class="block text-gray-500">${selection.type === "tab" ? "Tab" : "Chord"}</span>
      ${selection.model ? `<span class="block text-gray-500">${selection.model}</span>` : ""}
    `;
    contentDiv.appendChild(infoDiv);

    // Tab notes
    if (selection.type === "tab" && selection.notesPlainText?.length) {
      const notesDiv = document.createElement("div");
      notesDiv.className = "text-xs whitespace-pre-wrap mt-1 text-center";
      notesDiv.innerHTML = selection.notesPlainText.join("\n");
      contentDiv.appendChild(notesDiv);
    }

    // Chord keys
    if (selection.type === "chord" && selection.keys?.length) {
      const chordKeysDiv = document.createElement("div");
      chordKeysDiv.className = "text-xs mt-1 text-center";
      chordKeysDiv.innerHTML = selection.keys
        .map(k => `${k.noteName}${k.octave} (r=${k.y}, s=${k.x})`)
        .join("<br>");
      contentDiv.appendChild(chordKeysDiv);
    }

    // Favorite + tags
    if (selection.type === "chord" && selection.favorite) {
      const favDiv = document.createElement("div");
      favDiv.className = "text-sm mt-1 text-center text-red-500";
      favDiv.textContent = "❤️ Favorite";
      contentDiv.appendChild(favDiv);
    }
    if (selection.type === "chord" && selection.tags) {
      const tagsDiv = document.createElement("div");
      tagsDiv.className = "text-xs mt-1 text-center text-gray-700";
      tagsDiv.textContent = "Tags: " + selection.tags;
      contentDiv.appendChild(tagsDiv);
    }

    // Optional date/time
    if (selection.date || selection.time) {
      const dtDiv = document.createElement("div");
      dtDiv.className = "block text-center text-gray-400 text-xs mt-1";
      dtDiv.textContent = (selection.date || "") + " " + (selection.time || "");
      contentDiv.appendChild(dtDiv);
    }

    // Clicking => load
    contentDiv.addEventListener("click", () => {
      loadSelection(selection);
    });

    libraryContent.appendChild(div);
  });

  // Pagination bar
  if (totalPages > 1) {
    const paginationDiv = document.createElement("div");
    paginationDiv.className = wideModeEnabled
      ? "flex items-center justify-center mt-4 space-x-4 col-span-4"
      : "flex items-center justify-center mt-4 space-x-4";
    
    const pageInfo = document.createElement("span");
    pageInfo.className = "text-sm text-gray-700";
    pageInfo.textContent = `Page ${libraryPageIndex + 1} of ${totalPages}`;
    paginationDiv.appendChild(pageInfo);

    // Prev
    if (libraryPageIndex > 0) {
      const prevBtn = document.createElement("button");
      prevBtn.className = "px-3 py-1 bg-slate-500 text-white text-xs rounded hover:bg-slate-600";
      prevBtn.textContent = "Prev";
      prevBtn.addEventListener("click", () => {
        libraryPageIndex--;
        populateLibrary();
      });
      paginationDiv.appendChild(prevBtn);
    }

    // Next
    if (libraryPageIndex < totalPages - 1) {
      const nextBtn = document.createElement("button");
      nextBtn.className = "px-3 py-1 bg-slate-500 text-white text-xs rounded hover:bg-slate-600";
      nextBtn.textContent = "Next";
      nextBtn.addEventListener("click", () => {
        libraryPageIndex++;
        populateLibrary();
      });
      paginationDiv.appendChild(nextBtn);
    }

    libraryContent.appendChild(paginationDiv);
  }
}

/******************************************************
 * deleteSelectionByObject(selection):
 *  - Removes matching item from localStorage 
 *    then re-populates library.
 ******************************************************/
function deleteSelectionByObject(selection) {
  if (!confirm("Are you sure you want to delete this selection?")) return;
  const all = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
  let index = all.findIndex(it => it === selection);

  // If not found by direct reference, try to match content
  if (index < 0) {
    index = all.findIndex(it =>
      it.type === selection.type &&
      it.name === selection.name &&
      JSON.stringify(it.keys) === JSON.stringify(selection.keys)
    );
  }

  if (index >= 0) {
    all.splice(index, 1);
    localStorage.setItem("harpejjiSelections", JSON.stringify(all));
  }
  populateLibrary();
}

/******************************************************
 * previewItem(selection):
 *  - Preview chord or tab directly.
 ******************************************************/
function previewItem(selection) {
  if (selection.type === "chord" && selection.keys) {
    previewChord(selection.keys);
  } else if (selection.type === "tab" && selection.notesPlainText) {
    previewTab(selection.notesPlainText);
  }
}

/******************************************************
 * previewChord(keys):
 *  - Create oscillators for each chord note,
 *    hold ~200ms, then stop.
 ******************************************************/
async function previewChord(keys) {
  if (!keys || !keys.length) return;
  const oscList = [];
  for (const k of keys) {
    const freq = noteToFrequency(k.noteName, k.octave);
    const oscObj = await createOscillator(freq, "piano");
    oscList.push(oscObj);
  }
  setTimeout(() => {
    oscList.forEach(o => stopOscillator(o));
  }, 200);
}

/******************************************************
 * previewTab(notesPlainText):
 *  - Each entry is like "C#3", "Ab4", etc. 
 *    We'll play them all at once for ~1.5s, then stop.
 ******************************************************/
async function previewTab(notes) {
  if (!Array.isArray(notes) || !notes.length) return;
  const oscList = [];
  for (const noteStr of notes) {
    const match = noteStr.match(/^([A-G](?:#|b)?)(\d+)/);
    if (!match) continue;
    const noteName = match[1];
    const octave   = parseInt(match[2], 10);
    const freq     = noteToFrequency(noteName, octave);
    const oscObj   = await createOscillator(freq, "piano");
    oscList.push(oscObj);
  }
  setTimeout(() => {
    oscList.forEach(o => stopOscillator(o));
  }, 1500);
}

/******************************************************
 * allNotesInCurrentScale(notesArray):
 *  - Checks if each tab note fits current scale+root
 ******************************************************/
function allNotesInCurrentScale(notesArray) {
  if (!notesArray || !notesArray.length) return true;
  if (currentScale === "none") return true;

  const scaleSet = getScaleSemitones(currentScale, currentRoot);
  if (!scaleSet.size) return true;

  function mapAccidentalsToSharps(name) {
    const table = {
      "Cb": "B","Db": "C#","Eb": "D#","Fb": "E","Gb": "F#",
      "Ab": "G#","Bb": "A#","E#": "F","B#": "C"
    };
    return table[name] || name;
  }

  for (const noteStr of notesArray) {
    const match = noteStr.match(/^([A-G](?:#|b)?)(\d+)/);
    if (!match) return false;
    let rawName = match[1];
    rawName = mapAccidentalsToSharps(rawName);
    const noteIndex = NOTES.indexOf(rawName);
    if (noteIndex < 0) return false;
    if (!scaleSet.has(noteIndex)) return false;
  }
  return true;
}

/******************************************************
 * allChordNotesInCurrentScale(keysArray):
 *  - Checks if each chord note fits current scale+root
 ******************************************************/
function allChordNotesInCurrentScale(keysArray) {
  if (!keysArray || !keysArray.length) return true;
  if (currentScale === "none") return true;

  const scaleSet = getScaleSemitones(currentScale, currentRoot);
  if (!scaleSet.size) return true;

  function mapAccidentalsToSharps(name) {
    const table = {
      "Cb": "B","Db": "C#","Eb": "D#","Fb": "E","Gb": "F#",
      "Ab": "G#","Bb": "A#","E#": "F","B#": "C"
    };
    return table[name] || name;
  }

  for (const k of keysArray) {
    let rawName = mapAccidentalsToSharps(k.noteName);
    const noteIndex = NOTES.indexOf(rawName);
    if (noteIndex < 0) return false;
    if (!scaleSet.has(noteIndex)) return false;
  }
  return true;
}

/******************************************************
 * getScaleSemitones(scaleName, rootNote):
 *  - Build a Set of pitch classes in the chosen scale
 ******************************************************/
function getScaleSemitones(scaleName, rootNote) {
  if (!scaleName || scaleName === "none") return new Set();
  const intervals = loadedScales[scaleName];
  if (!intervals) return new Set();
  const rootIndex = NOTES.indexOf(rootNote);
  if (rootIndex < 0) return new Set();

  let setPC = new Set();
  let currentPos = 0;
  setPC.add(rootIndex % 12);
  intervals.forEach(iv => {
    currentPos += iv;
    setPC.add((rootIndex + currentPos) % 12);
  });
  return setPC;
}

/******************************************************
 * loadSelection(data):
 *  - If it's a tab => switch models, copy keysState, re-draw
 *  - If it's a chord => prompt which chord slot to load
 ******************************************************/
export function loadSelection(data) {
  if (data.type === "tab") {
    if (data.modelData) {
      setCurrentModelData(data.modelData);
    } else if (data.model && MODELS[data.model]) {
      setCurrentModel(data.model);
    }

    initKeysState();
    if (data.keysState) {
      for (let y = 0; y < data.keysState.length; y++) {
        for (let x = 0; x < data.keysState[y].length; x++) {
          if (y < numberOfFrets && x < numberOfStrings) {
            keysState[y][x] = data.keysState[y][x];
          }
        }
      }
    }

    drawTablature();
    drawPianoRoll();
    drawSequencerGrid();
  } else if (data.type === "chord") {
    const slotNum = parseInt(prompt("Which chord slot (1-8)?"), 10);
    if (isNaN(slotNum) || slotNum < 1 || slotNum > 8) {
      alert("Invalid chord slot.");
      return;
    }
    const sIndex = slotNum - 1;
    chordSlots[sIndex].name = data.name;
    chordSlots[sIndex].keys = data.keys.map(k => ({
      x: k.x,
      y: k.y,
      noteName: k.noteName,
      octave: k.octave
    }));
    chordSlots[sIndex].favorite = !!data.favorite;
    chordSlots[sIndex].tags = data.tags || "";
    chordSlots[sIndex].image = data.image || null;

    import("./chordPalette.js").then(({ updateChordPaletteUI }) => {
      updateChordPaletteUI();
    });
  }
  toggleLibrary();
}

/******************************************************
 * setCurrentModelData(data):
 *  - If a tab has modelData => apply it to currentModel
 ******************************************************/
function setCurrentModelData(modelData) {
  if (!modelData) return;
  currentModel.numberOfStrings = modelData.numberOfStrings;
  currentModel.numberOfFrets   = modelData.numberOfFrets;
  currentModel.startNote       = modelData.startNote;
  currentModel.startOctave     = modelData.startOctave;
  currentModel.endNote         = modelData.endNote;
  currentModel.endOctave       = modelData.endOctave;

  window.numberOfStrings = modelData.numberOfStrings;
  window.numberOfFrets   = modelData.numberOfFrets;
  window.BASE_NOTE       = modelData.startNote;
  window.BASE_OCTAVE     = modelData.startOctave;
}

/******************************************************
 * handleFileLoad():
 *  - Load a single .json tab/chord from disk => loadSelection
 ******************************************************/
export function handleFileLoad() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (rEv) => {
      try {
        const data = JSON.parse(rEv.target.result);
        loadSelection(data);
      } catch (err) {
        alert("Error loading selection file:" + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/******************************************************
 * saveLibrary():
 *  - Download the entire "harpejjiSelections" array to .json
 ******************************************************/
export function saveLibrary() {
  const arr = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
  if (!arr.length) {
    alert("No selections to save.");
    return;
  }
  const blob = new Blob([JSON.stringify(arr, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "harpejji_library.json";
  a.click();
  URL.revokeObjectURL(url);
}

/******************************************************
 * saveLibraryAs():
 *  - Same but prompt for name
 ******************************************************/
export function saveLibraryAs() {
  const arr = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
  if (!arr.length) {
    alert("No selections to save.");
    return;
  }
  const filename = prompt("Enter file name:", "harpejji_library");
  if (!filename) return;

  const blob = new Blob([JSON.stringify(arr, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

/******************************************************
 * loadLibrary():
 *  - Overwrite localStorage with a library file
 ******************************************************/
export function loadLibrary() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (rEv) => {
      try {
        const data = JSON.parse(rEv.target.result);
        if (!Array.isArray(data)) throw new Error("Library must be an array.");
        const valid = data.every(it => it.type === "tab" || it.type === "chord");
        if (!valid) throw new Error("Invalid items in library file.");
        localStorage.setItem("harpejjiSelections", JSON.stringify(data));
        populateLibrary();
      } catch (err) {
        alert("Error loading library:" + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/******************************************************
 * clearLibrary():
 *  - Confirm, then remove "harpejjiSelections"
 ******************************************************/
export function clearLibrary() {
  if (!confirm("Are you sure you want to clear the library?")) return;
  localStorage.removeItem("harpejjiSelections");
  populateLibrary();
}

/******************************************************
 * Helper to get the filename without extension
 ******************************************************/
function getFilenameBase(fullName) {
  return fullName.replace(/\.[^/.]+$/, "");
}

/******************************************************
 * importFiles():
 *  - Import multiple JSON files => merges them into localStorage
 *  - NEW: If a chord is found, rename it from the filename (minus extension)
 ******************************************************/
export function importFiles() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.multiple = true;
  input.onchange = (e) => {
    const files = e.target.files;
    if (!files.length) return;
    const saved = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
    let processed = 0;

    Array.from(files).forEach(file => {
      const baseName = getFilenameBase(file.name);
      const reader = new FileReader();
      reader.onload = (rEv) => {
        try {
          const data = JSON.parse(rEv.target.result);
          // Single item or array of items:
          if (data.type === "tab" || data.type === "chord") {
            if (data.type === "chord") {
              data.name = baseName; // rename chord
            }
            saved.push(data);
          } else if (Array.isArray(data)) {
            data.forEach(d => {
              if (d.type === "tab" || d.type === "chord") {
                if (d.type === "chord") {
                  d.name = baseName; // rename chord
                }
                saved.push(d);
              }
            });
          }
        } catch (err) {
          console.error("Error importing file:", err);
        }
        processed++;
        if (processed === files.length) {
          localStorage.setItem("harpejjiSelections", JSON.stringify(saved));
          populateLibrary();
        }
      };
      reader.readAsText(file);
    });
  };
  input.click();
}

/******************************************************
 * printLibrary():
 *  - Open new window, print library items
 ******************************************************/
export function printLibrary() {
  const arr = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
  if (!arr.length) {
    alert("No items in library to print.");
    return;
  }

  const enlarged = document.getElementById("enlargedCheckbox")?.checked;
  const highContrast = document.getElementById("highContrastCheckbox")?.checked;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Unable to open print window.");
    return;
  }

  let styleRules = "";
  if (!enlarged && !highContrast) {
    // 2 columns, 4 rows
    styleRules = `
      .print-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-gap: 20px;
      }
      .print-item {
        border: 1px solid #ccc;
        padding: 10px;
        page-break-inside: avoid;
        text-align: center;
      }
      .print-item img {
        width: 200px;
        height: 200px;
        object-fit: contain;
        margin-bottom: 10px;
      }
    `;
  } else if (enlarged && !highContrast) {
    // 1 item/page, normal
    styleRules = `
      .print-grid {
        display: block;
      }
      .print-item {
        border: 1px solid #ccc;
        padding: 20px;
        page-break-after: always;
        text-align: center;
        background-color: #fff;
        color: #000;
      }
      .print-item img {
        display: block;
        margin: 0 auto 10px auto;
        width: 80%;
        height: auto;
        object-fit: contain;
      }
    `;
  } else if (!enlarged && highContrast) {
    // 2x4 black background
    styleRules = `
      .print-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-gap: 20px;
      }
      .print-item {
        border: 2px solid #000;
        page-break-inside: avoid;
        padding: 10px;
        text-align: center;
        background-color: #000;
        color: #fff;
      }
      .print-item img {
        width: 200px;
        height: 200px;
        object-fit: contain;
        margin-bottom: 10px;
      }
    `;
  } else {
    // both enlarged + highContrast => 1 item/page, black bg
    styleRules = `
      .print-grid {
        display: block;
      }
      .print-item {
        border: 2px solid #000;
        page-break-after: always;
        padding: 20px;
        text-align: center;
        background-color: #000;
        color: #fff;
      }
      .print-item img {
        display: block;
        margin: 0 auto 10px auto;
        width: 80%;
        height: auto;
        object-fit: contain;
      }
    `;
  }

  let html = `
    <html>
    <head>
      <title>Print Library</title>
      <style>
        body { font-family: sans-serif; margin: 20px; }
        ${styleRules}
      </style>
    </head>
    <body>
      <h1>Harpejji Library</h1>
      <div class="print-grid">
  `;

  arr.forEach((item, idx) => {
    const nameLabel = item.name || `Item ${idx + 1}`;
    const imageSrc = item.image ? `<img src="${item.image}"/>` : "";
    const modelLine = item.model ? `<p>Model: ${item.model}</p>` : "";
    let extra = "";

    if (item.type === "chord") {
      extra += "<p>(Chord)</p>";
      if (item.keys?.length) {
        const lines = item.keys
          .map(k => `${k.noteName}${k.octave} (r=${k.y}, s=${k.x})`)
          .join("<br>");
        extra += `<p style="margin-top:0.5rem;font-size:0.8rem">${lines}</p>`;
      }
      if (item.favorite) {
        extra += `<p style="color:red;font-size:0.9rem;margin-top:0.5rem">❤️ Favorite</p>`;
      }
      if (item.tags) {
        extra += `<p style="margin-top:0.5rem;font-size:0.8rem">Tags: ${item.tags}</p>`;
      }
    } else if (item.type === "tab") {
      extra += "<p>(Tab)</p>";
      if (item.notesPlainText?.length) {
        const lines = item.notesPlainText.join("<br>");
        extra += `<p style="margin-top:0.5rem;font-size:0.8rem">${lines}</p>`;
      }
    }

    html += `
      <div class="print-item">
        ${imageSrc}
        <h3>${nameLabel}</h3>
        ${modelLine}
        ${extra}
      </div>
    `;
  });

  html += `
      </div>
    </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onload = function() {
    printWindow.focus();
    printWindow.print();
  };
}

/******************************************************
 * importFilesScaleLocked()
 *  - Import multiple chord/tab .json files
 *    but only keep items that fit the current scale
 *  - NEW: If chord is kept, rename with filename minus extension
 ******************************************************/
export function importFilesScaleLocked() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.multiple = true;

  input.onchange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const saved = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
    let importedCount = 0;
    let rejectedCount = 0;
    let processed = 0;

    files.forEach(file => {
      const baseName = getFilenameBase(file.name);
      const reader = new FileReader();
      reader.onload = (rEv) => {
        try {
          const data = JSON.parse(rEv.target.result);
          const items = Array.isArray(data) ? data : [data];

          for (const item of items) {
            if (item.type !== "tab" && item.type !== "chord") {
              rejectedCount++;
              continue;
            }
            let passesScale;
            if (item.type === "tab") {
              passesScale = allNotesInCurrentScale(item.notesPlainText);
            } else {
              passesScale = allChordNotesInCurrentScale(item.keys);
            }

            if (passesScale) {
              if (item.type === "chord") {
                item.name = baseName; 
              }
              saved.push(item);
              importedCount++;
            } else {
              rejectedCount++;
            }
          }
        } catch (err) {
          console.error("Error importing file:", err);
          rejectedCount++;
        }
        processed++;
        if (processed === files.length) {
          localStorage.setItem("harpejjiSelections", JSON.stringify(saved));
          populateLibrary();
          alert(
            `Scale-Locked Import Complete.\nImported: ${importedCount}\nRejected: ${rejectedCount}`
          );
        }
      };
      reader.readAsText(file);
    });
  };

  input.click();
}

/* ********************************************************************
 *  CHORD TOOL FUNCTIONALITY
 *    1) openChordToolPopup(selection)
 *    2) build transformation rows
 *    3) on "Generate", create each new chord, 
 *       CLEAR the board, mark the chord -> capture updated image,
 *       revert board, and prompt user to save.
 ********************************************************************* */

/**
 * openChordToolPopup(selection)
 *  - Save the selection for reference
 *  - Show the popup
 *  - Clear transformation rows
 *  - Add 1 row by default
 */
function openChordToolPopup(chordSelection) {
  chordToolSourceChord = chordSelection;
  const popup = document.getElementById("chordToolPopup");
  if (!popup) return;

  const transformContainer = document.getElementById("chordToolTransformations");
  transformContainer.innerHTML = "";

  popup.classList.remove("hidden");

  // Add 1 initial row
  addTransformationRow();

  // Close
  const closeBtn = document.getElementById("closeChordToolPopup");
  closeBtn.onclick = () => {
    chordToolSourceChord = null;
    popup.classList.add("hidden");
  };

  // Add transformation button
  document.getElementById("addTransformationBtn").onclick = () => {
    addTransformationRow();
  };

  // Generate button
  document.getElementById("generateChordsBtn").onclick = () => {
    generateBatchChords();
  };
}

function addTransformationRow() {
  const container = document.getElementById("chordToolTransformations");
  const rowDiv = document.createElement("div");
  rowDiv.className = "flex items-center gap-2";

  // Col shift
  const colInput = document.createElement("input");
  colInput.type = "number";
  colInput.placeholder = "Col Shift";
  colInput.className = "w-20 border rounded px-2 py-1 text-sm";
  colInput.value = "0";

  // Row shift
  const rowInput = document.createElement("input");
  rowInput.type = "number";
  rowInput.placeholder = "Row Shift";
  rowInput.className = "w-20 border rounded px-2 py-1 text-sm";
  rowInput.value = "0";

  // Remove
  const removeBtn = document.createElement("button");
  removeBtn.textContent = "-";
  removeBtn.className = "px-2 py-1 bg-rose-500 text-white rounded hover:bg-rose-600 text-sm";
  removeBtn.onclick = () => {
    container.removeChild(rowDiv);
  };

  rowDiv.appendChild(document.createTextNode("Col:"));
  rowDiv.appendChild(colInput);
  rowDiv.appendChild(document.createTextNode("Row:"));
  rowDiv.appendChild(rowInput);
  rowDiv.appendChild(removeBtn);

  container.appendChild(rowDiv);
}

/**
 * generateBatchChords()
 *  - For each transformation row => 
 *    shift the chord => build name => CLEAR board => mark chord => capture => revert => confirm => save.
 */
async function generateBatchChords() {
  if (!chordToolSourceChord) return;

  const transformContainer = document.getElementById("chordToolTransformations");
  const rows = transformContainer.querySelectorAll("div.flex.items-center");
  if (!rows.length) {
    alert("No transformations specified.");
    return;
  }

  const originalName = chordToolSourceChord.name || "Chord";
  const originalKeys = chordToolSourceChord.keys || [];
  if (!originalKeys.length) {
    alert("No keys found in the chord to transform.");
    return;
  }

  // For each transformation row
  for (let i = 0; i < rows.length; i++) {
    const inputs = rows[i].querySelectorAll("input");
    const colShiftVal = parseInt(inputs[0].value, 10) || 0;
    const rowShiftVal = parseInt(inputs[1].value, 10) || 0;

    // Build name suffix (rowshift first, then colshift)
    const rowPart = rowShiftVal === 0 
      ? "rowshift_0" 
      : (rowShiftVal > 0 ? `rowshift_plus${rowShiftVal}` : `rowshift_minus${Math.abs(rowShiftVal)}`);
    const colPart = colShiftVal === 0 
      ? "colshift_0"
      : (colShiftVal > 0 ? `colshift_plus${colShiftVal}` : `colshift_minus${Math.abs(colShiftVal)}`);

    const nameSuffix = `_${rowPart}_${colPart}`;
    const newName = originalName + nameSuffix;

    // Apply shift
    const newKeys = applyRowColShift(originalKeys, rowShiftVal, colShiftVal);

    if (!newKeys.length) {
      alert(`Skipping transformation #${i+1} because all notes ended up out of range.`);
      continue;
    }

    // Preview chord (optional)
    await previewChord(newKeys);

    // Automated approach: 
    //  1) capture a fresh image of the SHIFTED chord with blue circles 
    //  2) prompt user to save
    const chordImage = renderChordAndCaptureImage(newKeys);

    const ok = confirm(`Transformation #${i+1}:\n"${newName}"\nSave this chord as a file?`);
    if (!ok) {
      // skip saving
      continue;
    }

    // Grab the current model (for library filtering)
    const currentModelSelect = document.getElementById("modelSelect");
    const chordModel = currentModelSelect ? currentModelSelect.value : null;

    // Save to JSON with newly captured image
    const chordData = {
      type: "chord",
      name: newName,
      keys: newKeys,
      model: chordModel,
      image: chordImage,
      timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(chordData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // remove spaces from name
    a.download = newName.replace(/\s+/g, "_") + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Done
  document.getElementById("chordToolPopup").classList.add("hidden");
  chordToolSourceChord = null;
}

/**
 * applyRowColShift(originalKeys, rowShift, colShift)
 */
function applyRowColShift(originalKeys, rowShift, colShift) {
  const newKeys = [];
  for (const k of originalKeys) {
    const newX = k.x + colShift;
    const newY = k.y + rowShift;
    if (
      newX >= 0 && newX < numberOfStrings &&
      newY >= 0 && newY < numberOfFrets
    ) {
      newKeys.push({
        x: newX,
        y: newY,
        noteName: k.noteName,
        octave: k.octave
      });
    }
  }
  return newKeys;
}

/**
 * renderChordAndCaptureImage(chordKeys):
 *  - Save user’s current board state
 *  - Clear board
 *  - Mark chord keys so the circles are visible
 *  - drawTablature()
 *  - captureChordImage(...) from chordPalette.js
 *  - Restore board state
 *  - Return the base64-encoded chord image
 */
function renderChordAndCaptureImage(chordKeys) {
  // Deep copy current keysState
  const oldKeysState = JSON.parse(JSON.stringify(keysState));

  // Clear board
  initKeysState();

  // Mark chord keys
  chordKeys.forEach(k => {
    if (
      k.x >= 0 && k.x < numberOfStrings &&
      k.y >= 0 && k.y < numberOfFrets
    ) {
      keysState[k.y][k.x].marker = true;
    }
  });

  drawTablature();

  // Use the chordPalette capture function
  const tempChord = { keys: chordKeys };
  const chordImage = captureChordImage(tempChord);

  // Restore user’s old board
  for (let y = 0; y < oldKeysState.length; y++) {
    for (let x = 0; x < oldKeysState[y].length; x++) {
      keysState[y][x] = oldKeysState[y][x];
    }
  }
  drawTablature();

  return chordImage;
}
