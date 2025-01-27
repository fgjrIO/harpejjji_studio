/******************************************************
 * library.js
 *
 * Manages:
 *  - LocalStorage-based library of tab/chord items
 *  - Toggling the library side panel
 *  - Filtering by type, scale, model
 *  - Loading a selection (tab or chord) back into the app
 *  - Printing, importing, exporting
 *
 * CHANGES:
 *  - Added a "Preview" button for each library item (both chord & tab).
 *  - The button calls `previewItem(selection)` to play the notes temporarily.
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

// We need to create/stop oscillators for our preview:
import { createOscillator, stopOscillator } from "./audio.js";

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
 * populateLibrary():
 *  - Read the array from localStorage => "harpejjiSelections"
 *  - Filter by type, scale, model
 *  - Render items in #libraryContent
 ******************************************************/
export function populateLibrary() {
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

  for (let i = 0; i < savedSelections.length; i++) {
    const selection = savedSelections[i];

    // Type filter (tabs vs. chords vs. all)
    if (libraryFilterVal !== "all") {
      const wantType = (libraryFilterVal === "tabs") ? "tab" : "chord";
      if (selection.type !== wantType) {
        continue;
      }
    }

    // Model filter
    if (modelFilterVal !== "all" && modelFilterVal) {
      if (!selection.model || selection.model !== modelFilterVal) {
        continue;
      }
    }

    // Scale filter
    if (doScaleFilter) {
      if (selection.type === "tab") {
        if (!allNotesInCurrentScale(selection.notesPlainText)) {
          continue;
        }
      } else if (selection.type === "chord") {
        if (!allChordNotesInCurrentScale(selection.keys)) {
          continue;
        }
      }
    }

    // Build DOM element for the library item
    const div = document.createElement("div");
    div.className = "relative p-2 border rounded hover:bg-gray-100";

    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "absolute top-2 right-2 px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 text-xs";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSelection(i);
    });
    div.appendChild(deleteBtn);

    // NEW: Preview button (plays the chord or tab right away)
    const previewBtn = document.createElement("button");
    previewBtn.className = "absolute top-2 right-16 px-2 py-1 rounded bg-emerald-500 text-white hover:bg-emerald-600 text-xs";
    previewBtn.textContent = "Preview";
    previewBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // don’t trigger load
      previewItem(selection);
    });
    div.appendChild(previewBtn);

    // Content wrapper for clicks (loads selection)
    const contentDiv = document.createElement("div");
    contentDiv.className = "cursor-pointer selection-content";
    div.appendChild(contentDiv);

    // If there is an image, display it
    if (selection.image) {
      const img = document.createElement("img");
      img.src = selection.image;
      img.alt = selection.name;
      img.className = "w-full h-32 object-contain mb-2 bg-white";
      contentDiv.appendChild(img);
    }

    // Basic info (name, type, model)
    const infoDiv = document.createElement("div");
    infoDiv.className = "text-sm text-center";
    infoDiv.innerHTML = `
      <span class="block font-bold">${selection.name}</span>
      <span class="block text-gray-500">${selection.type === "tab" ? "Tab" : "Chord"}</span>
      ${selection.model ? `<span class="block text-gray-500">${selection.model}</span>` : ""}
    `;
    contentDiv.appendChild(infoDiv);

    // Notes text for tabs
    if (selection.type === "tab" && selection.notesPlainText?.length) {
      const notesDiv = document.createElement("div");
      notesDiv.className = "text-xs whitespace-pre-wrap mt-1 text-center";
      notesDiv.innerHTML = selection.notesPlainText.join("\n");
      contentDiv.appendChild(notesDiv);
    }

    // Keys info for chords
    if (selection.type === "chord" && selection.keys?.length) {
      const chordKeysDiv = document.createElement("div");
      chordKeysDiv.className = "text-xs mt-1 text-center";
      chordKeysDiv.innerHTML = selection.keys
        .map(k => `${k.noteName}${k.octave} (r=${k.y}, s=${k.x})`)
        .join("<br>");
      contentDiv.appendChild(chordKeysDiv);
    }

    // Favorite heart + Tags
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

    // Clicking the content => load the selection
    contentDiv.addEventListener("click", () => {
      loadSelection(selection);
    });

    libraryContent.appendChild(div);
  }
}

/******************************************************
 * previewItem(selection):
 *  - Play a chord or tab directly from the library.
 *    No need to load or assign it to a chord slot.
 ******************************************************/
async function previewItem(selection) {
  if (selection.type === "chord" && selection.keys) {
    await previewChord(selection.keys);
  } else if (selection.type === "tab" && selection.notesPlainText) {
    await previewTab(selection.notesPlainText);
  }
}

/******************************************************
 * previewChord(keys):
 *  - Create oscillators for each chord note, 
 *    hold for ~1.5 seconds, then stop them.
 ******************************************************/
async function previewChord(keys) {
  if (!keys || !keys.length) return;
  const oscList = [];
  for (const k of keys) {
    const freq = noteToFrequency(k.noteName, k.octave);
    // Use "piano" instrument or any other you'd like for preview
    const oscObj = await createOscillator(freq, "piano");
    oscList.push(oscObj);
  }
  setTimeout(() => {
    oscList.forEach(o => stopOscillator(o));
  }, 1500);
}

/******************************************************
 * previewTab(notesPlainText):
 *  - Each entry in notesPlainText is something like "C#3", "Ab4", etc.
 *    We'll play them all at once for ~1.5 seconds, then stop.
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
      "Cb": "B", "Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#",
      "Ab": "G#", "Bb": "A#", "E#": "F", "B#": "C"
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
      "Cb": "B", "Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#",
      "Ab": "G#", "Bb": "A#", "E#": "F", "B#": "C"
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
  // include root first
  setPC.add(rootIndex % 12);
  intervals.forEach(iv => {
    currentPos += iv;
    setPC.add((rootIndex + currentPos) % 12);
  });
  return setPC;
}

/******************************************************
 * deleteSelection(index):
 *  - Remove item from localStorage array
 ******************************************************/
function deleteSelection(index) {
  if (!confirm("Are you sure you want to delete this selection?")) return;
  const arr = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
  arr.splice(index, 1);
  localStorage.setItem("harpejjiSelections", JSON.stringify(arr));
  populateLibrary();
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
 * importFiles():
 *  - Import multiple JSON files => merges them into localStorage
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
      const reader = new FileReader();
      reader.onload = (rEv) => {
        try {
          const data = JSON.parse(rEv.target.result);
          // Single item or array of items:
          if (data.type === "tab" || data.type === "chord") {
            saved.push(data);
          } else if (Array.isArray(data)) {
            data.forEach(d => {
              if (d.type === "tab" || d.type === "chord") {
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
 * setCurrentModelData(data):
 *  - If a tab has modelData => apply to currentModel
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

/* ===========================================================
   NEW FUNCTION: importFilesScaleLocked()
   =========================================================== */

/**
 * importFilesScaleLocked():
 *  - Lets user select multiple JSON files (tabs/chords)
 *  - Imports them all at once without prompting after each file
 *  - Only items that fit the current scale are added
 *  - Summarizes total imported vs. rejected at the end
 */
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

    // Process each file
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (rEv) => {
        try {
          const data = JSON.parse(rEv.target.result);
          const items = Array.isArray(data) ? data : [data];

          for (const item of items) {
            // Must be chord or tab
            if (item.type !== "tab" && item.type !== "chord") {
              rejectedCount++;
              continue;
            }

            // Check scale consonance
            let passesScale = false;
            if (item.type === "tab") {
              passesScale = allNotesInCurrentScale(item.notesPlainText);
            } else if (item.type === "chord") {
              passesScale = allChordNotesInCurrentScale(item.keys);
            }

            if (passesScale) {
              saved.push(item);
              importedCount++;
            } else {
              rejectedCount++;
            }
          }
        } catch (err) {
          console.error("Error importing file:", err);
          // Entire file is invalid => count as rejected
          rejectedCount++;
        }
        processed++;
        if (processed === files.length) {
          // Once all files processed, finalize library
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

  // Trigger the file chooser
  input.click();
}
