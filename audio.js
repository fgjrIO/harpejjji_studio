/******************************************************
 * audio.js
 *
 * Manages:
 *  - A shared AudioContext (exposed as window.audioContext)
 *  - Master gain, delay, reverb
 *  - 2-oscillator + noise synth engine with LFO, filter, ADSR, etc.
 *  - "killAllNotes()" for total stop
 ******************************************************/

import {
  currentInstrument,
  keysState,
  numberOfFrets,
  numberOfStrings,
  fadeNotes,
  fadeTime
} from "./globals.js";

import { recordedNotes } from "./sequencer.js";
import { drawTablature } from "./tablature.js";

let masterGain = null;
let delayNode = null;
let delayGain = null;
let reverbConvolver = null;
let reverbGain = null;

const allLiveOscillators = new Set();
export const activeUserOscillators = new Map();

/******************************************************
 * Store the user-controlled synth parameters here.
 * They will be updated in real-time via the UI
 * event listeners in initSynthSettingsUI().
 ******************************************************/
const synthParams = {
  // Oscillator 1
  osc1Wave: "sine",
  osc1PulseWidth: 50, // percent
  osc1Tune: 0,        // semitones
  osc1Mix: 50,        // 0-100

  // Oscillator 2
  osc2Track: false,
  osc2Sync: false,
  osc2Wave: "sine",
  osc2PulseWidth: 50,
  osc2Tune: 0,
  osc2Mix: 50,

  // Noise
  noiseOn: false,
  noiseMix: 0, // 0-100

  // LFO
  lfoRouting: "amplitude", // amplitude | filter | pitch
  lfoWave: "triangle",
  lfoFrequency: 5.0,
  lfoDepth: 50, // percent (0-100)

  // Glide & Unison (simple placeholders)
  glideOn: false,
  glideTime: 0.1,
  unisonOn: false,
  unisonVoices: 1,

  // Filter
  filterType: "lowpass12", // lowpass12 or lowpass24
  filterResonance: 0,      // 0-100
  filterEnvelopeAmt: 0,    // 0-100

  // ADSR
  adsrAttack: 0.01,
  adsrDecay: 0.3,
  adsrSustain: 50, // percent
  adsrRelease: 0.5
};

/******************************************************
 * initAudio():
 * Creates one shared AudioContext with master gain,
 * plus global delay and reverb. Called once.
 ******************************************************/
export async function initAudio() {
  if (window.audioContext) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    alert("Your browser does not support Web Audio API.");
    return;
  }

  window.audioContext = new AudioContextClass();

  if (window.audioContext.state === "suspended") {
    try {
      await window.audioContext.resume();
    } catch (error) {
      console.error("Failed to resume audio context:", error);
    }
  }

  // Master Gain
  masterGain = window.audioContext.createGain();
  masterGain.gain.value = 0.1;
  masterGain.connect(window.audioContext.destination);

  // Delay
  delayNode = window.audioContext.createDelay(5.0);
  delayGain = window.audioContext.createGain();
  delayGain.gain.value = 0;
  delayNode.connect(delayGain);
  delayGain.connect(masterGain);

  // Reverb (simple random impulse)
  reverbConvolver = window.audioContext.createConvolver();
  const length = window.audioContext.sampleRate * 1.0;
  const impulse = window.audioContext.createBuffer(2, length, window.audioContext.sampleRate);
  for (let c = 0; c < 2; c++) {
    const channelData = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      channelData[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
  }
  reverbConvolver.buffer = impulse;

  reverbGain = window.audioContext.createGain();
  reverbGain.gain.value = 0;
  reverbConvolver.connect(reverbGain);
  reverbGain.connect(masterGain);

  // Initialize the UI event listeners for synth settings
  initSynthSettingsUI();
}

/******************************************************
 * loadUIParam(id, parseFunc):
 * Helper to read a DOM element’s value by id and
 * parse it. If the element isn't found or invalid,
 * does nothing.
 ******************************************************/
function loadUIParam(id, setterFn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", () => {
    setterFn(el.value);
  });
  // On page load, set initial
  setterFn(el.value);
}

/******************************************************
 * initSynthSettingsUI():
 * Attaches event listeners to each control in the
 * Synth Settings slideover so that any changes
 * update our local synthParams in real-time.
 ******************************************************/
function initSynthSettingsUI() {
  // Osc1
  loadUIParam("osc1Wave", (v) => (synthParams.osc1Wave = v));
  loadUIParam("osc1PulseWidth", (v) => (synthParams.osc1PulseWidth = parseFloat(v)));
  loadUIParam("osc1Tune", (v) => (synthParams.osc1Tune = parseFloat(v)));
  loadUIParam("osc1Mix", (v) => (synthParams.osc1Mix = parseFloat(v)));

  // Osc2
  const osc2TrackToggle = document.getElementById("osc2TrackToggle");
  if (osc2TrackToggle) {
    osc2TrackToggle.addEventListener("change", () => {
      synthParams.osc2Track = osc2TrackToggle.checked;
    });
    synthParams.osc2Track = osc2TrackToggle.checked;
  }

  const osc2SyncToggle = document.getElementById("osc2SyncToggle");
  if (osc2SyncToggle) {
    osc2SyncToggle.addEventListener("change", () => {
      synthParams.osc2Sync = osc2SyncToggle.checked;
    });
    synthParams.osc2Sync = osc2SyncToggle.checked;
  }

  loadUIParam("osc2Wave", (v) => (synthParams.osc2Wave = v));
  loadUIParam("osc2PulseWidth", (v) => (synthParams.osc2PulseWidth = parseFloat(v)));
  loadUIParam("osc2Tune", (v) => (synthParams.osc2Tune = parseFloat(v)));
  loadUIParam("osc2Mix", (v) => (synthParams.osc2Mix = parseFloat(v)));

  // Noise
  const noiseToggle = document.getElementById("noiseToggle");
  if (noiseToggle) {
    noiseToggle.addEventListener("change", () => {
      synthParams.noiseOn = noiseToggle.checked;
    });
    synthParams.noiseOn = noiseToggle.checked;
  }
  loadUIParam("noiseMix", (v) => (synthParams.noiseMix = parseFloat(v)));

  // LFO
  loadUIParam("lfoRouting", (v) => (synthParams.lfoRouting = v));
  loadUIParam("lfoWave", (v) => (synthParams.lfoWave = v));
  loadUIParam("lfoFrequency", (v) => (synthParams.lfoFrequency = parseFloat(v)));
  loadUIParam("lfoDepth", (v) => (synthParams.lfoDepth = parseFloat(v)));

  // Glide & Unison
  const glideToggle = document.getElementById("glideToggle");
  if (glideToggle) {
    glideToggle.addEventListener("change", () => {
      synthParams.glideOn = glideToggle.checked;
    });
    synthParams.glideOn = glideToggle.checked;
  }
  loadUIParam("glideTime", (v) => (synthParams.glideTime = parseFloat(v)));

  const unisonToggle = document.getElementById("unisonToggle");
  if (unisonToggle) {
    unisonToggle.addEventListener("change", () => {
      synthParams.unisonOn = unisonToggle.checked;
    });
    synthParams.unisonOn = unisonToggle.checked;
  }
  loadUIParam("unisonVoices", (v) => (synthParams.unisonVoices = parseInt(v, 10)));

  // Filter
  loadUIParam("filterType", (v) => (synthParams.filterType = v));
  loadUIParam("filterResonance", (v) => (synthParams.filterResonance = parseFloat(v)));
  loadUIParam("filterEnvelopeAmt", (v) => (synthParams.filterEnvelopeAmt = parseFloat(v)));

  // ADSR
  loadUIParam("adsrAttack", (v) => (synthParams.adsrAttack = parseFloat(v)));
  loadUIParam("adsrDecay", (v) => (synthParams.adsrDecay = parseFloat(v)));
  loadUIParam("adsrSustain", (v) => (synthParams.adsrSustain = parseFloat(v)));
  loadUIParam("adsrRelease", (v) => (synthParams.adsrRelease = parseFloat(v)));
}

/******************************************************
 * createOscillator(frequency, instrument):
 * Called to play a note at a certain frequency
 * with the chosen instrument. In our new design,
 * 'instrument' is always "synth," so we branch
 * to createSynthSound().
 ******************************************************/
export async function createOscillator(frequency, instrument) {
  if (!window.audioContext) await initAudio();
  if (window.audioContext.state === "suspended") {
    try {
      await window.audioContext.resume();
    } catch (error) {
      console.error("Failed to resume audio context:", error);
    }
  }

  // We only have "synth" now (the UI replaced old instruments)
  const soundObj = await createSynthSound(frequency);

  // We store a wrapper so the old "stopOscillator()" logic still works
  const oscWrapper = {
    osc: { stop: soundObj.stop },
    gain: { disconnect: () => {} }
  };
  allLiveOscillators.add(oscWrapper);
  return oscWrapper;
}

/******************************************************
 * stopOscillator(oscObj):
 * Stop and remove an oscillator from our set.
 ******************************************************/
export function stopOscillator(oscObj) {
  if (!oscObj) return;
  if (oscObj.osc && typeof oscObj.osc.stop === "function") {
    oscObj.osc.stop();
  }
  allLiveOscillators.delete(oscObj);
}

/******************************************************
 * killAllNotes():
 * Stop every live oscillator and also reset
 * pressing/fading states.
 ******************************************************/
export function killAllNotes() {
  for (let o of allLiveOscillators) {
    if (o.osc && typeof o.osc.stop === "function") {
      o.osc.stop();
    }
  }
  allLiveOscillators.clear();

  activeUserOscillators.clear();

  recordedNotes.forEach((n) => {
    if (n.isPlaying && n.oscObj) {
      stopOscillator(n.oscObj);
      n.oscObj = null;
      n.isPlaying = false;
      keysState[n.y][n.x].sequencerPlaying = false;
    }
  });

  for (let fy = 0; fy < numberOfFrets; fy++) {
    for (let fx = 0; fx < numberOfStrings; fx++) {
      keysState[fy][fx].pressing = false;
      keysState[fy][fx].fading = false;
      keysState[fy][fx].fadeOutStart = null;
    }
  }
  drawTablature();
}

/******************************************************
 * setDelayAmount(value):
 * Connect to the user Delay slider
 ******************************************************/
export function setDelayAmount(value) {
  if (!delayGain) return;
  delayGain.gain.value = value;
}

/******************************************************
 * setReverbAmount(value):
 * Connect to the user Reverb slider
 ******************************************************/
export function setReverbAmount(value) {
  if (!reverbGain) return;
  reverbGain.gain.value = value;
}

/******************************************************
 * createSynthSound(frequency):
 * Build a full 2-osc + noise + LFO + filter + ADSR
 * signal chain, using the dynamic synthParams.
 * Returns an object with a .stop() method.
 ******************************************************/
async function createSynthSound(frequency) {
  if (!window.audioContext) await initAudio();

  const now = window.audioContext.currentTime;

  // Final note volume
  const noteGain = window.audioContext.createGain();
  noteGain.gain.value = 0;

  // Main Filter
  const filter = window.audioContext.createBiquadFilter();
  if (synthParams.filterType === "lowpass24") {
    // We'll approximate 24dB by boosting Q or chaining filters
    // For simplicity, just set type to "lowpass" & a higher Q:
    filter.type = "lowpass";
    // The user’s resonance is from 0..100 => 0..20 Q range
    filter.Q.value = (synthParams.filterResonance / 100) * 20;
  } else {
    // lowpass12
    filter.type = "lowpass";
    filter.Q.value = (synthParams.filterResonance / 100) * 10;
  }
  // We'll set filter cutoff later, once we apply envelope (if any).
  filter.frequency.value = 20000; // wide open initially

  // Connect filter -> noteGain -> master + reverb + delay
  filter.connect(noteGain);
  noteGain.connect(masterGain);
  noteGain.connect(delayNode);
  noteGain.connect(reverbConvolver);

  // Create LFO
  const lfoOsc = window.audioContext.createOscillator();
  const lfoGain = window.audioContext.createGain();
  lfoOsc.type = synthParams.lfoWave || "triangle";
  lfoOsc.frequency.value = synthParams.lfoFrequency;
  // Depth is 0..100 => 0..1 gain scale
  lfoGain.gain.value = synthParams.lfoDepth / 100;

  // We'll connect the LFO depending on routing
  if (synthParams.lfoRouting === "amplitude") {
    // route to noteGain.gain
    lfoOsc.connect(lfoGain);
    lfoGain.connect(noteGain.gain);
  } else if (synthParams.lfoRouting === "filter") {
    // route to filter frequency
    lfoOsc.connect(lfoGain);
    lfoGain.connect(filter.frequency);
  } else if (synthParams.lfoRouting === "pitch") {
    // route to a gain that modulates oscillator frequency
    // We'll do it inside the oscillator creation
    // We'll attach each oscillator freq param to lfoGain
  }

  // Start LFO
  lfoOsc.start(now);

  // Create the two main oscillators
  // We mix them based on osc1Mix/osc2Mix
  const osc1 = createVoiceOsc(frequency, synthParams.osc1Wave, synthParams.osc1Tune, synthParams.osc1PulseWidth);
  const osc2 = createVoiceOsc(frequency, synthParams.osc2Wave, synthParams.osc2Tune, synthParams.osc2PulseWidth);

  const osc1Gain = window.audioContext.createGain();
  const osc2Gain = window.audioContext.createGain();

  osc1Gain.gain.value = synthParams.osc1Mix / 100; // 0..1
  osc2Gain.gain.value = synthParams.osc2Mix / 100; // 0..1

  // If LFO routing = pitch, connect to each oscillator frequency
  if (synthParams.lfoRouting === "pitch") {
    lfoOsc.connect(lfoGain);
    lfoGain.connect(osc1.frequency);
    lfoGain.connect(osc2.frequency);
  }

  // Optional: If osc2Sync is on, sync osc2 to osc1
  // by connecting the "osc1.onended" or using setPeriodicWave. 
  // We'll do a simple approach: if osc2Sync is on, we set wave to "square" & no detune, etc.
  // (Real oscillator sync is more complicated in Web Audio.)
  if (synthParams.osc2Sync) {
    // We'll attempt real sync by using .setPeriodicWave, or skip it
    // This is a simple placeholder
    osc2Gain.gain.value = synthParams.osc2Mix / 100;
  }

  // Connect oscillators to filter
  osc1.connect(osc1Gain);
  osc1Gain.connect(filter);
  osc2.connect(osc2Gain);
  osc2Gain.connect(filter);

  // If we have noise on, create a noise buffer source
  let noiseSource = null;
  let noiseGain = null;
  if (synthParams.noiseOn) {
    noiseSource = createNoiseSource();
    noiseGain = window.audioContext.createGain();
    noiseGain.gain.value = synthParams.noiseMix / 100;
    noiseSource.connect(noiseGain);
    noiseGain.connect(filter);
    noiseSource.start(now);
  }

  // Envelope (ADSR) on noteGain
  // Also do a filter envelope if filterEnvelopeAmt>0
  const attackEnd = now + synthParams.adsrAttack;
  const decayEnd = attackEnd + synthParams.adsrDecay;
  const sustainLevel = synthParams.adsrSustain / 100; // 0..1

  // Start from 0
  noteGain.gain.cancelScheduledValues(now);
  noteGain.gain.setValueAtTime(0, now);
  // Attack up to 1.0
  noteGain.gain.linearRampToValueAtTime(1.0, attackEnd);
  // Decay down to sustain
  noteGain.gain.linearRampToValueAtTime(sustainLevel, decayEnd);

  // Filter envelope (if any)
  const filterEnvAmount = synthParams.filterEnvelopeAmt / 100;
  if (filterEnvAmount > 0) {
    // We'll do a simple approach: freq starts low, goes up
    // or you might do the reverse. We'll do a typical approach:
    const minFreq = 200;
    const maxFreq = 20000;
    const envStart = minFreq;
    const envPeak = maxFreq * filterEnvAmount;
    const envSustainFreq = envPeak * sustainLevel;

    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(envStart, now);
    filter.frequency.linearRampToValueAtTime(envPeak, attackEnd);
    filter.frequency.linearRampToValueAtTime(envSustainFreq, decayEnd);
  }

  // Start the oscillators
  osc1.start(now);
  osc2.start(now);

  return {
    stop: () => {
      const endNow = window.audioContext.currentTime;
      const releaseEnd = endNow + synthParams.adsrRelease;

      // Release for noteGain
      noteGain.gain.cancelScheduledValues(endNow);
      noteGain.gain.setValueAtTime(noteGain.gain.value, endNow);
      noteGain.gain.linearRampToValueAtTime(0.0001, releaseEnd);

      // If filter envelope => ramp down freq to something low
      if (filterEnvAmount > 0) {
        filter.frequency.cancelScheduledValues(endNow);
        filter.frequency.setValueAtTime(filter.frequency.value, endNow);
        filter.frequency.linearRampToValueAtTime(100, releaseEnd);
      }

      setTimeout(() => {
        osc1.stop();
        osc2.stop();
        lfoOsc.stop();
        osc1.disconnect();
        osc2.disconnect();
        lfoOsc.disconnect();
        osc1Gain.disconnect();
        osc2Gain.disconnect();
        filter.disconnect();
        noteGain.disconnect();
        if (noiseSource) {
          noiseSource.stop();
          noiseSource.disconnect();
        }
        if (noiseGain) noiseGain.disconnect();
      }, synthParams.adsrRelease * 1000 + 50);
    }
  };
}

/******************************************************
 * createVoiceOsc(frequency, waveType, tuneSemitones, pulseWidth):
 * Helper to build a single oscillator with a custom
 * wave if "pulse" is chosen, and handle tune.
 ******************************************************/
function createVoiceOsc(baseFreq, waveType, tuneSemitones, pulseWidth) {
  const osc = window.audioContext.createOscillator();
  let finalFreq = baseFreq * Math.pow(2, tuneSemitones / 12);
  osc.frequency.value = finalFreq;

  if (waveType === "pulse") {
    // Build a custom periodic wave at the given pulse width
    const pw = Math.max(0.01, pulseWidth / 100); // clamp
    const real = new Float32Array([0, 1 - pw, -1 * pw, 0]);
    const imag = new Float32Array(real.length);
    const wave = window.audioContext.createPeriodicWave(real, imag);
    osc.setPeriodicWave(wave);
  } else {
    osc.type = waveType;
  }
  return osc;
}

/******************************************************
 * createNoiseSource():
 * White noise generator using an AudioBufferSource
 ******************************************************/
function createNoiseSource() {
  const bufferSize = 2 * window.audioContext.sampleRate;
  const noiseBuffer = window.audioContext.createBuffer(1, bufferSize, window.audioContext.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }
  const noiseSource = window.audioContext.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;
  return noiseSource;
}
