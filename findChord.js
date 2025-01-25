/******************************************************
 * findChord.js
 *
 * Scans the currently marked notes on the tablature,
 * tries to match them to known chord definitions,
 * and displays suggestions in the #findChordPopup.
 ******************************************************/

import {
    CHORD_DEFINITIONS,
    keysState,
    numberOfFrets,
    numberOfStrings,
    NOTES,
    getNoteName,
    getNoteOctave,
    mod
  } from "./globals.js";
  
  /**
   * The findChord() function:
   *  - Gather all marked notes
   *  - Convert them to pitch classes
   *  - Compare them to chord definitions
   *  - Show top matches in #chordMatches
   *  - Reveal #findChordPopup
   */
  export function findChord() {
    const selectedPositions = [];
    for (let y = 0; y < numberOfFrets; y++) {
      for (let x = 0; x < numberOfStrings; x++) {
        if (keysState[y][x].marker) {
          const noteName = getNoteName(x, y);
          const octave = getNoteOctave(x, y);
          const pitchClass = NOTES.indexOf(noteName) % 12;
          selectedPositions.push({ noteName, octave, pitchClass });
        }
      }
    }
  
    const chordMatchesDiv = document.getElementById("chordMatches");
    if (!chordMatchesDiv) return;
  
    if (!selectedPositions.length) {
      chordMatchesDiv.innerHTML = `<p class="text-red-600">No notes selected.</p>`;
      document.getElementById("findChordPopup")?.classList.remove("hidden");
      return;
    }
  
    // Build a set of unique pitch classes
    const uniquePCs = Array.from(
      new Set(selectedPositions.map(sp => sp.pitchClass))
    );
  
    // We'll build a list of potential chord matches
    let chordResults = [];
  
    // Try each note in uniquePCs as a potential root
    for (let rootPC of uniquePCs) {
      // shift all pitch classes so rootPC is 0
      const shiftedSet = uniquePCs.map(pc => mod(pc - rootPC, 12));
  
      CHORD_DEFINITIONS.forEach(chDef => {
        let matchCount = 0;
        chDef.intervals.forEach(iv => {
          if (shiftedSet.includes(mod(iv, 12))) {
            matchCount++;
          }
        });
        chordResults.push({
          chordName: `${NOTES[rootPC]} ${chDef.name}`,
          total: chDef.intervals.length,
          matched: matchCount
        });
      });
    }
  
    // Sort: better matches first
    chordResults.sort((a, b) => {
      if (b.matched === a.matched) {
        return a.total - b.total; // fewer intervals => more likely
      }
      return b.matched - a.matched;
    });
  
    // Take top ~8
    const topMatches = chordResults.slice(0, 8);
  
    if (!topMatches.length) {
      chordMatchesDiv.innerHTML = `<p class="text-gray-600">No chord matches found.</p>`;
    } else {
      chordMatchesDiv.innerHTML = topMatches
        .map(m => `
          <div>
            <strong>${m.chordName}</strong>
            <span class="ml-2 text-gray-700">
              (Matched ${m.matched} / ${m.total})
            </span>
          </div>
        `).join("");
    }
  
    document.getElementById("findChordPopup")?.classList.remove("hidden");
  }
  