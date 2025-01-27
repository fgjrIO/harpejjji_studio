/******************************************************
 * audio.js
 *
 * Manages:
 *  - A shared AudioContext (exposed as window.audioContext)
 *  - Master gain, delay, reverb
 *  - Multi-oscillator synth (two oscillators + noise)
 *  - Two filters (12 dB and 24 dB)
 *  - Filter envelope & amplitude envelope
 *  - LFO routing (amp/pitch/filter)
 *  - Glide & Unison
 *  - "killAllNotes()" for total stop
 ******************************************************/

import {
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

// The main AudioContext
export async function initAudio() {
  if (window.audioContext) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    alert("Your browser does not support Web Audio API.");
    return;
  }

  window.audioContext = new AudioContextClass();
  
  if (window.audioContext.state === 'suspended') {
    try {
      await window.audioContext.resume();
    } catch (error) {
      console.error('Failed to resume audio context:', error);
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

  // Simple Reverb
  reverbConvolver = window.audioContext.createConvolver();
  const length = window.audioContext.sampleRate * 1.0;
  const impulse = window.audioContext.createBuffer(2, length, window.audioContext.sampleRate);
  for (let c = 0; c < 2; c++) {
    const channelData = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      channelData[i] = (Math.random()*2 -1)*(1 - i/length);
    }
  }
  reverbConvolver.buffer = impulse;
  reverbGain = window.audioContext.createGain();
  reverbGain.gain.value = 0;
  reverbConvolver.connect(reverbGain);
  reverbGain.connect(masterGain);
}

/**
 * Reads current synth parameters from the UI (DOM).
 * Returns an object with all relevant settings.
 */
function getSynthSettingsFromDOM() {
  // Osc1
  const osc1WaveType    = (document.getElementById("osc1WaveType")?.value) || "sawtooth";
  const osc1PulseWidth  = parseFloat(document.getElementById("osc1PulseWidth")?.value || "50") / 100;
  const osc1Tune        = parseFloat(document.getElementById("osc1Tune")?.value || "0");
  const osc1Mix         = parseFloat(document.getElementById("osc1Mix")?.value || "50") / 100;
  const osc1Track       = !!document.getElementById("osc1Track")?.checked;
  const osc1Sync        = !!document.getElementById("osc1Sync")?.checked;

  // Osc2
  const osc2WaveType    = (document.getElementById("osc2WaveType")?.value) || "sawtooth";
  const osc2PulseWidth  = parseFloat(document.getElementById("osc2PulseWidth")?.value || "50") / 100;
  const osc2Tune        = parseFloat(document.getElementById("osc2Tune")?.value || "0");
  const osc2Mix         = parseFloat(document.getElementById("osc2Mix")?.value || "50") / 100;
  const osc2Track       = !!document.getElementById("osc2Track")?.checked;
  const osc2Sync        = !!document.getElementById("osc2Sync")?.checked;

  // Noise
  const noiseOn         = !!document.getElementById("noiseOn")?.checked;
  const noiseMix        = parseFloat(document.getElementById("noiseMix")?.value || "0") / 100;

  // LFO
  const lfoRouting      = (document.getElementById("lfoRouting")?.value) || "amplitude";
  const lfoWave         = (document.getElementById("lfoWave")?.value) || "triangle";
  const lfoFrequency    = parseFloat(document.getElementById("lfoFrequency")?.value || "5.0");
  const lfoDepth        = parseFloat(document.getElementById("lfoDepth")?.value || "50") / 100;

  // Glide & Unison
  const glideOn         = !!document.getElementById("glideOn")?.checked;
  const glideTime       = parseFloat(document.getElementById("glideTime")?.value || "0.2");
  const unisonOn        = !!document.getElementById("unisonOn")?.checked;
  const unisonVoices    = parseInt(document.getElementById("unisonVoices")?.value || "1", 10);

  // Filter 1
  const filter1Cutoff   = parseFloat(document.getElementById("filter1Cutoff")?.value || "2.0") * 1000; // kHz -> Hz
  const filter1Reso     = parseFloat(document.getElementById("filter1Resonance")?.value || "0") / 100; 
  const filter1EnvAmt   = parseFloat(document.getElementById("filter1EnvAmount")?.value || "50") / 100;

  // Filter 2
  const filter2Cutoff   = parseFloat(document.getElementById("filter2Cutoff")?.value || "2.0") * 1000;
  const filter2Reso     = parseFloat(document.getElementById("filter2Resonance")?.value || "0") / 100;
  const filter2EnvAmt   = parseFloat(document.getElementById("filter2EnvAmount")?.value || "50") / 100;

  // Filter Envelope
  const filterEnvA      = parseFloat(document.getElementById("filterEnvA")?.value || "0.1");
  const filterEnvD      = parseFloat(document.getElementById("filterEnvD")?.value || "0.3");
  const filterEnvS      = parseFloat(document.getElementById("filterEnvS")?.value || "70") / 100;
  const filterEnvR      = parseFloat(document.getElementById("filterEnvR")?.value || "0.5");

  // Amp Envelope
  const ampEnvA         = parseFloat(document.getElementById("ampEnvA")?.value || "0.01");
  const ampEnvD         = parseFloat(document.getElementById("ampEnvD")?.value || "0.2");
  const ampEnvS         = parseFloat(document.getElementById("ampEnvS")?.value || "50") / 100;
  const ampEnvR         = parseFloat(document.getElementById("ampEnvR")?.value || "0.5");

  return {
    // Oscillator settings
    osc1: { wave: osc1WaveType, pulseWidth: osc1PulseWidth, tune: osc1Tune, mix: osc1Mix, track: osc1Track, sync: osc1Sync },
    osc2: { wave: osc2WaveType, pulseWidth: osc2PulseWidth, tune: osc2Tune, mix: osc2Mix, track: osc2Track, sync: osc2Sync },
    noiseOn,
    noiseMix,

    // LFO
    lfo: {
      routing: lfoRouting,
      wave: lfoWave,
      frequency: lfoFrequency,
      depth: lfoDepth
    },

    // Glide, Unison
    glideOn,
    glideTime,
    unisonOn,
    unisonVoices,

    // Filters
    filter1: { cutoff: filter1Cutoff, resonance: filter1Reso, envAmount: filter1EnvAmt },
    filter2: { cutoff: filter2Cutoff, resonance: filter2Reso, envAmount: filter2EnvAmt },

    // Filter envelope
    filterEnv: {
      a: filterEnvA,
      d: filterEnvD,
      s: filterEnvS,
      r: filterEnvR
    },

    // Amplitude envelope
    ampEnv: {
      a: ampEnvA,
      d: ampEnvD,
      s: ampEnvS,
      r: ampEnvR
    }
  };
}

/**
 * createOscillator(frequency, instrument)
 * Called when you press or toggle a key.
 * Instead of separate “piano/guitar,” we’ll interpret
 * ‘instrument’ as “synth1 / 2 / 3 / 4,” but all use
 * the same multi-osc logic with the settings from the UI.
 */
export async function createOscillator(frequency, instrument) {
  if (!window.audioContext) await initAudio();
  if (window.audioContext.state === 'suspended') {
    try {
      await window.audioContext.resume();
    } catch (error) {
      console.error('Failed to resume audio context:', error);
    }
  }

  // We'll fetch the current UI-based synth parameters:
  const synthParams = getSynthSettingsFromDOM();

  // For demonstration, we won't treat synth1/2/3/4 differently.
  // But you could have different preset loading if needed.
  
  // We'll build the final voice audio node chain
  const voice = await createSynthVoice(frequency, synthParams);

  const oscWrapper = {
    voice,
    stop: () => {
      // Called by stopOscillator
      stopVoice(voice, synthParams);
    }
  };
  allLiveOscillators.add(oscWrapper);
  return oscWrapper;
}

/**
 * Stop a given oscillator object
 */
export function stopOscillator(oscObj) {
  if (!oscObj) return;
  if (oscObj.stop && typeof oscObj.stop === "function") {
    oscObj.stop();
  }
  allLiveOscillators.delete(oscObj);
}

/**
 * killAllNotes()
 * Stop everything currently playing, clear sets.
 */
export function killAllNotes() {
  for (let o of allLiveOscillators) {
    if (o.stop && typeof o.stop==="function") {
      o.stop();
    }
  }
  allLiveOscillators.clear();

  activeUserOscillators.clear();

  recordedNotes.forEach(n=>{
    if(n.isPlaying && n.oscObj) {
      stopOscillator(n.oscObj);
      n.oscObj= null;
      n.isPlaying= false;
      keysState[n.y][n.x].sequencerPlaying= false;
    }
  });

  for (let fy=0; fy<numberOfFrets; fy++){
    for (let fx=0; fx<numberOfStrings; fx++){
      keysState[fy][fx].pressing= false;
      keysState[fy][fx].fading= false;
      keysState[fy][fx].fadeOutStart= null;
    }
  }
  drawTablature();
}

/**
 * setDelayAmount(value)
 */
export function setDelayAmount(value) {
  if (!delayGain) return;
  delayGain.gain.value = value;
}

/**
 * setReverbAmount(value)
 */
export function setReverbAmount(value) {
  if (!reverbGain) return;
  reverbGain.gain.value = value;
}

/******************************************************
 * Internals for building the new multi-osc voice
 ******************************************************/

/**
 * createSynthVoice(frequency, synthParams)
 *  - Creates a single "voice," which may contain multiple
 *    oscillators (unison), plus 2 filters in parallel,
 *    noise, LFO, envelopes, etc.
 */
async function createSynthVoice(frequency, synthParams) {
  // Create a master node for the entire voice
  const voiceGain = window.audioContext.createGain();
  voiceGain.gain.value = 0; // We'll ramp up with amp envelope

  // Connect voice to master chain
  voiceGain.connect(masterGain);
  voiceGain.connect(delayNode);
  voiceGain.connect(reverbConvolver);

  // Create parallel filters
  const filter1 = window.audioContext.createBiquadFilter();
  filter1.type = "lowpass";
  filter1.frequency.value = synthParams.filter1.cutoff;
  filter1.Q.value = synthParams.filter1.resonance * 20; // Q ~ 0..20

  const filter2 = window.audioContext.createBiquadFilter();
  filter2.type = "lowpass";
  filter2.frequency.value = synthParams.filter2.cutoff;
  filter2.Q.value = synthParams.filter2.resonance * 20;

  // We'll need a gain node for each filter, then sum them
  const filter1Gain = window.audioContext.createGain();
  const filter2Gain = window.audioContext.createGain();

  filter1.connect(filter1Gain);
  filter2.connect(filter2Gain);

  const postFilterMix = window.audioContext.createGain();
  filter1Gain.connect(postFilterMix);
  filter2Gain.connect(postFilterMix);

  // Then route to the voiceGain
  postFilterMix.connect(voiceGain);

  // We'll have a pre-filter mixer node for the oscillators + noise
  const preFilterMix = window.audioContext.createGain();
  preFilterMix.connect(filter1);
  preFilterMix.connect(filter2);

  // If unison is ON, we create multiple sets of (osc1, osc2, noise)
  // each slightly detuned. We'll combine them into preFilterMix
  const voiceNodes = [];
  const voicesCount = synthParams.unisonOn ? synthParams.unisonVoices : 1;
  
  for (let v = 0; v < voicesCount; v++) {
    const subVoice = createSubVoiceOscillators(frequency, synthParams, v, voicesCount);
    subVoice.mixNode.connect(preFilterMix);
    voiceNodes.push(subVoice);
  }

  // If LFO is used, we create an LFO oscillator & route it
  const lfoOsc = window.audioContext.createOscillator();
  lfoOsc.type = synthParams.lfo.wave;
  lfoOsc.frequency.value = synthParams.lfo.frequency;

  // We create a gain to scale the LFO -> "depth"
  const lfoGain = window.audioContext.createGain();
  lfoGain.gain.value = synthParams.lfo.depth;

  lfoOsc.connect(lfoGain);

  // Then depending on routing, we connect lfoGain to either amplitude, filter freq, or pitch
  if (synthParams.lfo.routing === "amplitude") {
    // We'll modulate the voiceGain.gain
    lfoGain.connect(voiceGain.gain);
  } else if (synthParams.lfo.routing === "filter") {
    // Let's modulate filter1 & filter2 frequency
    lfoGain.connect(filter1.frequency);
    lfoGain.connect(filter2.frequency);
  } else if (synthParams.lfo.routing === "pitch") {
    // We'll modulate each subVoice's oscillator frequencies
    // We can do it by hooking to the detune param
    voiceNodes.forEach(sub => {
      sub.osc1Node.detune.value += 0; // We must connect param
      try { lfoGain.connect(sub.osc1Node.detune); } catch {}
      sub.osc2Node.detune.value += 0;
      try { lfoGain.connect(sub.osc2Node.detune); } catch {}
    });
  }

  lfoOsc.start(window.audioContext.currentTime);

  // For the filter envelope, we apply a standard ADSR shape to filter freq
  const now = window.audioContext.currentTime;
  const envA = synthParams.filterEnv.a;
  const envD = synthParams.filterEnv.d;
  const envS = synthParams.filterEnv.s;
  const envR = synthParams.filterEnv.r;

  // For each filter, we'll set initial freq, then ramp up, then down to sustain
  // The effective envelope amount is multiplied by the filter's envAmount param
  const baseF1 = synthParams.filter1.cutoff;
  const baseF2 = synthParams.filter2.cutoff;
  const envAmt1 = synthParams.filter1.envAmount * baseF1;
  const envAmt2 = synthParams.filter2.envAmount * baseF2;
  
  filter1.frequency.cancelScheduledValues(now);
  filter2.frequency.cancelScheduledValues(now);

  // Attack
  filter1.frequency.setValueAtTime(baseF1, now);
  filter1.frequency.linearRampToValueAtTime(baseF1 + envAmt1, now + envA);
  // Decay
  filter1.frequency.linearRampToValueAtTime(baseF1 + envAmt1*envS, now + envA + envD);

  filter2.frequency.setValueAtTime(baseF2, now);
  filter2.frequency.linearRampToValueAtTime(baseF2 + envAmt2, now + envA);
  filter2.frequency.linearRampToValueAtTime(baseF2 + envAmt2*envS, now + envA + envD);

  // amplitude envelope
  const ampA = synthParams.ampEnv.a;
  const ampD = synthParams.ampEnv.d;
  const ampS = synthParams.ampEnv.s;
  const ampR = synthParams.ampEnv.r;

  voiceGain.gain.cancelScheduledValues(now);
  voiceGain.gain.setValueAtTime(0, now);
  voiceGain.gain.linearRampToValueAtTime(1.0, now + ampA); // attack
  voiceGain.gain.linearRampToValueAtTime(ampS, now + ampA + ampD); // decay -> sustain

  return {
    voiceGain,
    postFilterMix,
    filter1,
    filter2,
    filter1Gain,
    filter2Gain,
    lfoOsc,
    lfoGain,
    voiceNodes,
    ampEnv: { a: ampA, d: ampD, s: ampS, r: ampR },
    filterEnv: { a: envA, d: envD, s: envS, r: envR },
    createdTime: now
  };
}

/**
 * createSubVoiceOscillators(frequency, synthParams, index, totalUnison)
 *  - For unison, we replicate this multiple times
 */
function createSubVoiceOscillators(freq, synthParams, index, totalUnison) {
  // We'll sum osc1 + osc2 + (optionally) noise
  const mixNode = window.audioContext.createGain();
  mixNode.gain.value = 1.0 / totalUnison; // so total doesn't blow up

  // A small unison offset
  const detuneCents = (index - (totalUnison-1)/2) * 5; // e.g. -5, 0, 5 for 3 voices

  // OSC1
  const osc1 = window.audioContext.createOscillator();
  osc1.type = synthParams.osc1.wave === "pulse" ? "square" : synthParams.osc1.wave;
  // If "pulse," we can implement a PWM with e.g. waveshaper or another method,
  // but let's keep it simple here.

  // If "glideOn," we could do a freq ramp from old -> freq. 
  // For simplicity, we'll just set freq. Real portamento is more advanced.
  const startTime = window.audioContext.currentTime;
  if (synthParams.glideOn) {
    osc1.frequency.setValueAtTime(0, startTime);
    osc1.frequency.exponentialRampToValueAtTime(freq, startTime + synthParams.glideTime);
  } else {
    osc1.frequency.value = freq;
  }

  // Add tune + unison detune
  const semitoneRatio = Math.pow(2, (synthParams.osc1.tune + detuneCents/100) / 12);
  osc1.frequency.value *= semitoneRatio;

  // Similarly for oscillator2
  const osc2 = window.audioContext.createOscillator();
  osc2.type = synthParams.osc2.wave === "pulse" ? "square" : synthParams.osc2.wave;
  if (synthParams.glideOn) {
    osc2.frequency.setValueAtTime(0, startTime);
    osc2.frequency.exponentialRampToValueAtTime(freq, startTime + synthParams.glideTime);
  } else {
    osc2.frequency.value = freq;
  }
  const semitoneRatio2 = Math.pow(2, (synthParams.osc2.tune + detuneCents/100) / 12);
  osc2.frequency.value *= semitoneRatio2;

  // For Hard Sync, we need to set one oscillator as the "master." 
  // We'll skip the actual implementation detail for brevity or do something simple:
  // If osc2Sync is on, we connect osc1 as the "sync master," but the Web Audio API doesn't have a built-in.
  // Typically, you'd do custom DSP. We'll skip a real sync.

  // We'll create separate gains for each oscillator:
  const osc1Gain = window.audioContext.createGain();
  osc1Gain.gain.value = synthParams.osc1.mix;
  osc1.connect(osc1Gain);
  osc1Gain.connect(mixNode);

  const osc2Gain = window.audioContext.createGain();
  osc2Gain.gain.value = synthParams.osc2.mix;
  osc2.connect(osc2Gain);
  osc2Gain.connect(mixNode);

  // Noise
  let noiseSource = null;
  if (synthParams.noiseOn) {
    const bufferSize = 2 * window.audioContext.sampleRate;
    const noiseBuffer = window.audioContext.createBuffer(1, bufferSize, window.audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noiseSource = window.audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const noiseGain = window.audioContext.createGain();
    noiseGain.gain.value = synthParams.noiseMix;
    noiseSource.connect(noiseGain);
    noiseGain.connect(mixNode);
    noiseSource.start();
  }

  osc1.start();
  osc2.start();

  return {
    osc1Node: osc1,
    osc2Node: osc2,
    noiseNode: noiseSource, 
    mixNode
  };
}

/**
 * stopVoice(voice, synthParams)
 *  - Applies the release portion of amplitude & filter envelopes,
 *    then stops all oscillators after release time.
 */
function stopVoice(voice, synthParams) {
  if (!voice) return;
  const now = window.audioContext.currentTime;
  // amplitude envelope release
  const r = voice.ampEnv.r;

  // We'll release filter envelope, too
  const filterA = voice.filterEnv.a;
  const filterD = voice.filterEnv.d;
  const filterS = voice.filterEnv.s;
  const filterR = voice.filterEnv.r;

  // We do an envelope to 0 over release time
  voice.voiceGain.gain.cancelScheduledValues(now);
  const currentVal = voice.voiceGain.gain.value;
  voice.voiceGain.gain.setValueAtTime(currentVal, now);
  voice.voiceGain.gain.linearRampToValueAtTime(0.0001, now + r);

  // Filter freq release as well: 
  // We'll just ramp both filters back to base freq or something close
  voice.filter1.frequency.cancelScheduledValues(now);
  voice.filter2.frequency.cancelScheduledValues(now);

  // We'll do a simple linear ramp to base freq
  const baseF1 = synthParams.filter1.cutoff;
  const baseF2 = synthParams.filter2.cutoff;
  voice.filter1.frequency.setValueAtTime(voice.filter1.frequency.value, now);
  voice.filter1.frequency.linearRampToValueAtTime(baseF1, now + filterR);

  voice.filter2.frequency.setValueAtTime(voice.filter2.frequency.value, now);
  voice.filter2.frequency.linearRampToValueAtTime(baseF2, now + filterR);

  // We'll stop everything after release
  setTimeout(() => {
    try {
      voice.voiceNodes.forEach(sub => {
        sub.osc1Node.stop();
        sub.osc2Node.stop();
        if (sub.noiseNode) {
          sub.noiseNode.stop();
        }
      });
      voice.lfoOsc.stop();
    } catch(e) {
      // ignore
    }

    // Disconnect
    try {
      voice.voiceGain.disconnect();
    } catch {}
    try {
      voice.postFilterMix.disconnect();
    } catch {}
    try {
      voice.filter1.disconnect();
      voice.filter2.disconnect();
    } catch {}
    try {
      voice.filter1Gain.disconnect();
      voice.filter2Gain.disconnect();
    } catch {}
    try {
      voice.lfoOsc.disconnect();
      voice.lfoGain.disconnect();
    } catch {}
    (voice.voiceNodes||[]).forEach(sub => {
      try { sub.osc1Node.disconnect(); } catch {}
      try { sub.osc2Node.disconnect(); } catch {}
      try { sub.mixNode.disconnect(); } catch {}
      if (sub.noiseNode) {
        try { sub.noiseNode.disconnect(); } catch {}
      }
    });
  }, r*1000 + 50);
}
