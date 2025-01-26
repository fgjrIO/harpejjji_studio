/******************************************************
 * audio.js
 *
 * Manages:
 *  - A shared AudioContext (exposed as window.audioContext)
 *  - Master gain, delay, reverb
 *  - Oscillator creation/stopping
 *  - "killAllNotes()" for total stop
 ******************************************************/

import {
  currentInstrument,
  instrumentMap,
  keysState,
  numberOfFrets,
  numberOfStrings,
  fadeNotes,
  fadeTime
} from "./globals.js";

import { recordedNotes } from "./sequencer.js"; // to kill sequencer notes
import { drawTablature } from "./tablature.js";

/**
 * We keep a single audioContext & master chain for the entire app.
 * We also keep a global set of all oscillators, so we can forcibly stop them.
 */

// We store it on `window.audioContext` so that the sequencer can refer to it
// without encountering undefined.
let masterGain = null;
let delayNode = null;
let delayGain = null;
let reverbConvolver = null;
let reverbGain = null;

/**
 * A set of all active oscillator objects. 
 * Each object typically has { osc: { stop() }, gain: { ... } }.
 */
const allLiveOscillators = new Set();

/**
 * A map of user-initiated oscillators by key "x_y".
 */
export const activeUserOscillators = new Map();

/******************************************************
 * initAudio():
 *  - Creates window.audioContext if not already
 *  - Sets up masterGain, delay, reverb
 ******************************************************/
export async function initAudio() {
  // If we already have audioContext on window, do nothing
  if (window.audioContext) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    alert("Your browser does not support Web Audio API.");
    return;
  }

  window.audioContext = new AudioContextClass();
  
  // Ensure audioContext is resumed on initialization
  if (window.audioContext.state === 'suspended') {
    try {
      await window.audioContext.resume();
    } catch (error) {
      console.error('Failed to resume audio context:', error);
    }
  }

  masterGain = window.audioContext.createGain();
  masterGain.gain.value = 0.1;
  masterGain.connect(window.audioContext.destination);

  // Delay
  delayNode = window.audioContext.createDelay(5.0);
  delayGain = window.audioContext.createGain();
  delayGain.gain.value = 0;
  delayNode.connect(delayGain);
  delayGain.connect(masterGain);

  // Reverb
  reverbConvolver = window.audioContext.createConvolver();
  // Build a random impulse
  const length = window.audioContext.sampleRate * 1.0;
  const impulse = window.audioContext.createBuffer(2, length, window.audioContext.sampleRate);
  for (let c = 0; c < 2; c++) {
    const channelData = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      channelData[i] = (Math.random()*2 -1)*(1 - i/length);
    }
  }
  reverbConvolver.buffer= impulse;

  reverbGain = window.audioContext.createGain();
  reverbGain.gain.value= 0;
  reverbConvolver.connect(reverbGain);
  reverbGain.connect(masterGain);
}

/******************************************************
 * createOscillator(frequency, instrument):
 *   - calls createInstrumentSound()
 *   - wraps in a simpler object
 ******************************************************/
export async function createOscillator(frequency, instrument) {
  if (!window.audioContext) await initAudio();
  
  // Double-check context state before creating sound
  if (window.audioContext.state === 'suspended') {
    try {
      await window.audioContext.resume();
    } catch (error) {
      console.error('Failed to resume audio context:', error);
    }
  }
  
  const soundObj = await createInstrumentSound(frequency, instrument);

  const oscWrapper = {
    osc: { stop: soundObj.stop },
    gain: { disconnect: ()=>{} }
  };
  allLiveOscillators.add(oscWrapper);
  return oscWrapper;
}

/******************************************************
 * stopOscillator(oscObj):
 *   - calls oscObj.osc.stop(), 
 *   - removes it from allLiveOscillators
 ******************************************************/
export function stopOscillator(oscObj) {
  if (!oscObj) return;
  if (oscObj.osc && typeof oscObj.osc.stop==="function") {
    oscObj.osc.stop();
  }
  allLiveOscillators.delete(oscObj);
}

/******************************************************
 * killAllNotes():
 *   - stops all oscillators (user + sequencer)
 *   - resets pressing/fading
 ******************************************************/
export function killAllNotes() {
  // Stop all
  for (let o of allLiveOscillators) {
    if(o.osc && typeof o.osc.stop==="function") {
      o.osc.stop();
    }
  }
  allLiveOscillators.clear();

  // Clear user map
  activeUserOscillators.clear();

  // Stop sequencer notes
  recordedNotes.forEach(n=>{
    if(n.isPlaying && n.oscObj) {
      stopOscillator(n.oscObj);
      n.oscObj= null;
      n.isPlaying= false;
      keysState[n.y][n.x].sequencerPlaying= false;
    }
  });

  // Reset pressing/fading
  for (let fy=0; fy<numberOfFrets; fy++){
    for (let fx=0; fx<numberOfStrings; fx++){
      keysState[fy][fx].pressing= false;
      keysState[fy][fx].fading= false;
      keysState[fy][fx].fadeOutStart= null;
    }
  }

  drawTablature();
}

/******************************************************
 * setDelayAmount(value), setReverbAmount(value):
 *  - allow external UI to control these sends
 ******************************************************/
export function setDelayAmount(value) {
  if (!delayGain) return;
  delayGain.gain.value = value;
}
export function setReverbAmount(value) {
  if (!reverbGain) return;
  reverbGain.gain.value = value;
}

/******************************************************
 * createInstrumentSound(frequency, instrument):
 *   - 2 slightly detuned oscillators
 *   - lowpass filter
 *   - ADSR envelope
 *   - master, delay, reverb sends
 ******************************************************/
async function createInstrumentSound(frequency, instrument) {
  if (!window.audioContext) await initAudio();

  const noteGain = window.audioContext.createGain();
  noteGain.gain.value= 0; // will fade in via ADSR

  const filter= window.audioContext.createBiquadFilter();
  filter.type= "lowpass";

  let envelope= { attack:0.01, decay:0.3, sustain:0.2, release:0.5 };
  let filterFreq= 2000;
  switch(instrument) {
    case "piano":
      envelope= { attack:0.01, decay:0.3, sustain:0.2, release:0.8 };
      filterFreq= 3000;
      break;
    case "guitar":
      envelope= { attack:0.01, decay:0.2, sustain:0.1, release:0.6 };
      filterFreq= 2500;
      break;
    case "ukulele":
      envelope= { attack:0.01, decay:0.1, sustain:0.3, release:0.5 };
      filterFreq= 3500;
      break;
    case "harp":
      envelope= { attack:0.02, decay:0.2, sustain:0.3, release:1.0 };
      filterFreq= 4000;
      break;
    default:
      envelope= { attack:0.01, decay:0.2, sustain:0.2, release:0.5 };
      filterFreq= 2000;
  }

  // wave type from instrumentMap
  const waveType= instrumentMap[instrument] || "sine";
  const osc1= window.audioContext.createOscillator();
  const osc2= window.audioContext.createOscillator();
  osc1.type= waveType;
  osc2.type= waveType;
  osc1.frequency.value= frequency;
  osc2.frequency.value= frequency*1.003; // slight detune

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(noteGain);

  noteGain.connect(masterGain);
  noteGain.connect(delayNode);
  noteGain.connect(reverbConvolver);

  filter.frequency.value= filterFreq;

  const now= window.audioContext.currentTime;
  const atkEnd= now + envelope.attack;
  const decEnd= atkEnd+ envelope.decay;

  noteGain.gain.cancelScheduledValues(now);
  noteGain.gain.setValueAtTime(0, now);
  noteGain.gain.linearRampToValueAtTime(1, atkEnd);
  noteGain.gain.linearRampToValueAtTime(envelope.sustain, decEnd);

  osc1.start(now);
  osc2.start(now);

  return {
    stop: ()=>{
      const releaseStart= window.audioContext.currentTime;
      const releaseEnd= releaseStart+ envelope.release;
      noteGain.gain.cancelScheduledValues(releaseStart);
      noteGain.gain.setValueAtTime(noteGain.gain.value, releaseStart);
      noteGain.gain.linearRampToValueAtTime(0.0001, releaseEnd);
      setTimeout(()=>{
        osc1.stop();
        osc2.stop();
        osc1.disconnect();
        osc2.disconnect();
        filter.disconnect();
        noteGain.disconnect();
      }, envelope.release*1000+ 50);
    }
  };
}
