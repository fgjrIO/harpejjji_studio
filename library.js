/******************************************************
 * library.js
 *
 * Manages localStorage-based library items (tabs & chords):
 *  - Toggling the library slideover
 *  - Filtering (scale filter, model filter, type filter)
 *  - Displaying thumbnails, meta info
 *  - Deleting selections
 *  - Loading them back into the app
 *  - Import/export library files
 *  - Printing the library
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
    showNotes,
    setShowNotes,
    keyMode,
    setKeyMode,
    loadedScales,
    scaleHighlightColor,       // used if you want to filter by scale color? (rare)
  } from "./globals.js";
  
  import { drawTablature } from "./tablature.js";
  import { drawPianoRoll, drawSequencerGrid } from "./sequencer.js";
  import { chordSlots } from "./chordPalette.js";
  
  /******************************************************
   * toggleLibrary():
   * Show/hide the library side panel.
   ******************************************************/
  export function toggleLibrary() {
    const slideOver = document.getElementById("librarySlideover");
    if (!slideOver) return;
    slideOver.classList.toggle("hidden");
  }
  
  /******************************************************
   * populateLibrary():
   * Reads "harpejjiSelections" from localStorage,
   * applies filters, and renders items in #libraryContent.
   ******************************************************/
  export function populateLibrary() {
    const libraryContent = document.getElementById("libraryContent");
    if (!libraryContent) return;
  
    libraryContent.innerHTML = "";
  
    const savedSelections = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
    if (!savedSelections.length) {
      libraryContent.innerHTML = `<p class="text-gray-500 text-center">No saved selections yet</p>`;
      return;
    }
  
    // Which filters?
    const scaleFilterCheckbox = document.getElementById("scaleFilterCheckbox");
    const libraryFilterValue = document.querySelector('input[name="libraryFilter"]:checked')?.value || "all";
    const modelFilterSelect = document.getElementById("modelFilterSelect");
    const modelFilterValue = modelFilterSelect ? modelFilterSelect.value : "all";
  
    // If "Scale Filter" is checked, only keep items that fit current scale
    const doScaleFilter = scaleFilterCheckbox && scaleFilterCheckbox.checked && currentScale !== "none";
  
    for (let i = 0; i < savedSelections.length; i++) {
      const selection = savedSelections[i];
  
      // Type filter
      if (libraryFilterValue !== "all") {
        const wantType = (libraryFilterValue === "tabs") ? "tab" : "chord";
        if (selection.type !== wantType) continue;
      }
      // Model filter
      if (modelFilterValue !== "all") {
        if (!selection.model || selection.model !== modelFilterValue) {
          continue;
        }
      }
      // Scale filter if active (only for tabs)
      if (doScaleFilter && selection.type === "tab") {
        if (!allNotesInCurrentScale(selection.notesPlainText)) {
          continue;
        }
      }
  
      const div = document.createElement("div");
      div.className = "relative p-2 border rounded hover:bg-gray-100";
  
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "absolute top-2 right-2 px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 delete-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteSelection(i);
      });
      div.appendChild(deleteBtn);
  
      const contentDiv = document.createElement("div");
      contentDiv.className = "cursor-pointer selection-content";
      div.appendChild(contentDiv);
  
      if (selection.image) {
        const img = document.createElement("img");
        img.src = selection.image;
        img.alt = selection.name;
        img.className = "w-full h-32 object-contain mb-2 bg-white";
        contentDiv.appendChild(img);
      }
  
      // Title, type, model
      const infoDiv = document.createElement("div");
      infoDiv.className = "text-sm text-center";
      infoDiv.innerHTML = `
        <span class="block font-bold">${selection.name}</span>
        <span class="block text-gray-500">${selection.type === "tab" ? "Tab" : "Chord"}</span>
        ${selection.model ? `<span class="block text-gray-500">${selection.model}</span>` : ""}
      `;
      contentDiv.appendChild(infoDiv);
  
      // Possibly note details
      if (selection.type === "tab" && selection.notesPlainText?.length) {
        const notesDiv = document.createElement("div");
        notesDiv.className = "text-xs whitespace-pre-wrap mt-1 text-center";
        notesDiv.innerHTML = selection.notesPlainText.join("\n");
        contentDiv.appendChild(notesDiv);
      } else if (selection.type === "chord" && selection.keys?.length) {
        const chordKeysDiv = document.createElement("div");
        chordKeysDiv.className = "text-xs mt-1 text-center";
        chordKeysDiv.innerHTML = selection.keys
          .map(k => `${k.noteName}${k.octave} (r=${k.y}, s=${k.x})`)
          .join("<br>");
        contentDiv.appendChild(chordKeysDiv);
      }
  
      // Possibly date/time
      if (selection.date || selection.time) {
        const dtDiv = document.createElement("div");
        dtDiv.className = "block text-center text-gray-400 text-xs mt-1";
        dtDiv.textContent = (selection.date || "") + " " + (selection.time || "");
        contentDiv.appendChild(dtDiv);
      }
  
      // Clicking the content -> load
      contentDiv.addEventListener("click", () => {
        loadSelection(selection);
      });
  
      libraryContent.appendChild(div);
    }
  }
  
  /******************************************************
   * allNotesInCurrentScale(notesArray):
   * Checks if every note in notesArray fits the current scale.
   ******************************************************/
  function allNotesInCurrentScale(notesArray) {
    if (!notesArray || !notesArray.length) return true;
    if (!currentScale || currentScale === "none") return true;
  
    // We'll gather pitch classes for the chosen scale
    const scaleSet = getScaleSemitones(currentScale, currentRoot);
    if (!scaleSet.size) return true;
  
    for (const noteStr of notesArray) {
      // parse something like "C#3"
      const match = noteStr.match(/^([A-G]#?)(\d+)/);
      if (!match) return false;
      const rawNoteName = match[1];
      const noteIndex = NOTES.indexOf(rawNoteName);
      if (noteIndex < 0) return false;
      if (!scaleSet.has(noteIndex)) {
        return false;
      }
    }
    return true;
  }
  
  // We'll replicate the logic from tablature
  function getScaleSemitones(scaleName, rootNote) {
    if (!scaleName || scaleName === "none") return new Set();
    const intervals = loadedScales[scaleName];
    if (!intervals) return new Set();
    const rootIndex = NOTES.indexOf(rootNote);
    if (rootIndex < 0) return new Set();
  
    let setPCs = new Set();
    let currentPos = 0;
    setPCs.add(rootIndex % 12);
    intervals.forEach(interval => {
      currentPos += interval;
      setPCs.add((rootIndex + currentPos) % 12);
    });
    return setPCs;
  }
  
  /******************************************************
   * deleteSelection(index):
   * Removes an item from localStorage library by array index.
   ******************************************************/
  function deleteSelection(index) {
    if (!confirm("Are you sure you want to delete this selection?")) return;
    const savedSelections = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
    savedSelections.splice(index,1);
    localStorage.setItem("harpejjiSelections", JSON.stringify(savedSelections));
    populateLibrary();
  }
  
  /******************************************************
   * loadSelection(data):
   * Loads a "tab" or "chord" from library into the app.
   ******************************************************/
  export function loadSelection(data) {
    if (data.type === "tab") {
      // Switch models
      if (data.modelData) {
        setCurrentModelData(data.modelData);
      } else if (data.model && MODELS[data.model]) {
        setCurrentModel(data.model);
      }
  
      initKeysState();
      if (data.keysState) {
        // copy
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
      // user picks which chord slot to load
      const slotNum = parseInt(prompt("Which chord slot to load this chord into? (1-8)"),10);
      if (isNaN(slotNum) || slotNum<1 || slotNum>8) {
        alert("Invalid chord slot number.");
        return;
      }
      const slotIndex = slotNum-1;
      chordSlots[slotIndex].name = data.name;
      chordSlots[slotIndex].keys = data.keys.map(k => ({
        x: k.x,
        y: k.y,
        noteName: k.noteName,
        octave: k.octave
      }));
      import("./chordPalette.js").then(({ updateChordPaletteUI }) => {
        updateChordPaletteUI();
      });
    }
    toggleLibrary();
  }
  
  /******************************************************
   * handleFileLoad():
   * Loads a .json file from the disk as a single selection,
   * then calls loadSelection(data).
   ******************************************************/
  export function handleFileLoad() {
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
          loadSelection(data);
        } catch(err) {
          alert("Error loading file: " + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }
  
  /******************************************************
   * saveLibrary():
   * Downloads the entire library to a single .json file.
   ******************************************************/
  export function saveLibrary() {
    const savedSelections = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
    if (!savedSelections.length) {
      alert("No selections to save.");
      return;
    }
    const blob = new Blob([JSON.stringify(savedSelections,null,2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "harpejji_library.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  
  /******************************************************
   * saveLibraryAs():
   * same as saveLibrary, but prompts for a name
   ******************************************************/
  export function saveLibraryAs() {
    const savedSelections = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
    if (!savedSelections.length) {
      alert("No selections to save.");
      return;
    }
    const filename = prompt("Enter file name for library:", "harpejji_library");
    if (!filename) return;
  
    const blob = new Blob([JSON.stringify(savedSelections,null,2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
  
  /******************************************************
   * loadLibrary():
   * Overwrites localStorage library with a .json file the
   * user selects (which must be an array of tab/chord objects).
   ******************************************************/
  export function loadLibrary() {
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
          if (!Array.isArray(data)) {
            throw new Error("Invalid library file: must be an array of tab/chord objects.");
          }
          const isValid = data.every(item => item.type==="tab" || item.type==="chord");
          if (!isValid) {
            throw new Error("Some items are not recognized as tab or chord.");
          }
          localStorage.setItem("harpejjiSelections", JSON.stringify(data));
          populateLibrary();
        } catch(err) {
          alert("Error loading library: " + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }
  
  /******************************************************
   * clearLibrary():
   * Clears all items from localStorage.
   ******************************************************/
  export function clearLibrary() {
    if (!confirm("Are you sure you want to clear the library?")) return;
    localStorage.removeItem("harpejjiSelections");
    populateLibrary();
  }
  
  /******************************************************
   * importFiles():
   * Import multiple .json files (each containing tab/chord
   * or array of them) into library.
   ******************************************************/
  export function importFiles() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.multiple = true;
    input.onchange = (evt) => {
      const files = evt.target.files;
      if (!files.length) return;
      const savedSelections = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
      let processed = 0;
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            if (data.type==="tab" || data.type==="chord") {
              savedSelections.push(data);
            } else if (Array.isArray(data)) {
              data.forEach(d => {
                if (d.type==="tab" || d.type==="chord") {
                  savedSelections.push(d);
                }
              });
            }
          } catch(err) {
            console.error("Error importing file:", err);
          }
          processed++;
          if (processed === files.length) {
            localStorage.setItem("harpejjiSelections", JSON.stringify(savedSelections));
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
   * Opens a new window, prints library items in a grid
   * or single-page layout, possibly high-contrast, etc.
   ******************************************************/
  export function printLibrary() {
    const savedSelections = JSON.parse(localStorage.getItem("harpejjiSelections") || "[]");
    if (!savedSelections.length) {
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
  
    // 4 combos
    if (!enlarged && !highContrast) {
      // default: 2 columns x 4 rows
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
      // 1 item per page, normal
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
      // 2x4, black background
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
      // both enlarged + highContrast => 1 item/page, black BG
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
  
    let htmlContent = `
      <html>
      <head>
        <title>Print Library</title>
        <style>
          body {
            font-family: sans-serif;
            margin: 20px;
          }
          ${styleRules}
        </style>
      </head>
      <body>
        <h1>Harpejji Library</h1>
        <div class="print-grid">
    `;
  
    savedSelections.forEach((item, idx) => {
      const nameLabel = item.name || `Item ${idx+1}`;
      const imageSrc  = item.image ? `<img src="${item.image}" />` : "";
      const modelLine = item.model ? `<p>Model: ${item.model}</p>` : "";
      let extraInfo   = "";
  
      if (item.type==="chord") {
        extraInfo += "<p>(Chord)</p>";
        if (item.keys?.length) {
          const lines = item.keys.map(k => `${k.noteName}${k.octave} (r=${k.y}, s=${k.x})`).join("<br>");
          extraInfo += `<p style="margin-top:0.5rem;font-size:0.8rem">${lines}</p>`;
        }
      } else if (item.type==="tab") {
        extraInfo += "<p>(Tab)</p>";
        if (item.notesPlainText?.length) {
          const lines = item.notesPlainText.join("<br>");
          extraInfo += `<p style="margin-top:0.5rem;font-size:0.8rem">${lines}</p>`;
        }
      }
  
      htmlContent += `
        <div class="print-item">
          ${imageSrc}
          <h3>${nameLabel}</h3>
          ${modelLine}
          ${extraInfo}
        </div>
      `;
    });
  
    htmlContent += `
        </div>
      </body>
      </html>
    `;
  
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.onload = function() {
      printWindow.focus();
      printWindow.print();
    };
  }
  
  /******************************************************
   * setCurrentModelData(modelData):
   * If a tab object has modelData embedded (like older saves),
   * we apply that to the global model.
   ******************************************************/
  function setCurrentModelData(modelData) {
    if (!modelData) return;
    currentModel.numberOfStrings = modelData.numberOfStrings;
    currentModel.numberOfFrets   = modelData.numberOfFrets;
    currentModel.startNote       = modelData.startNote;
    currentModel.startOctave     = modelData.startOctave;
    currentModel.endNote         = modelData.endNote;
    currentModel.endOctave       = modelData.endOctave;
  
    // Reassign global copies
    window.numberOfStrings = modelData.numberOfStrings;
    window.numberOfFrets   = modelData.numberOfFrets;
    window.BASE_NOTE       = modelData.startNote;
    window.BASE_OCTAVE     = modelData.startOctave;
  }
  