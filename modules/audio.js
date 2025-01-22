import { instrumentMap } from './config.js';
import { noteToFrequency } from './utils.js';

class AudioEngine {
  constructor() {
    this.audioContext = null;
    this.masterGainNode = null;
    this.delayNode = null;
    this.delayGain = null;
    this.reverbConvolver = null;
    this.reverbGain = null;
    this.activeOscillators = new Map();
  }

  init() {
    if (this.audioContext) return;
    
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGainNode = this.audioContext.createGain();
    this.masterGainNode.gain.value = 0.1;

    // Setup delay
    this.delayNode = this.audioContext.createDelay(5.0);
    this.delayGain = this.audioContext.createGain();
    this.delayGain.gain.value = 0;
    this.delayNode.connect(this.delayGain);
    this.delayGain.connect(this.masterGainNode);

    // Setup reverb
    this.setupReverb();

    this.masterGainNode.connect(this.audioContext.destination);
  }

  setupReverb() {
    this.reverbConvolver = this.audioContext.createConvolver();
    const length = this.audioContext.sampleRate * 1.0;
    const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
    
    for (let c = 0; c < 2; c++) {
      const channel = impulse.getChannelData(c);
      for (let i = 0; i < length; i++) {
        channel[i] = (Math.random() * 2 - 1) * (1 - i / length);
      }
    }
    
    this.reverbConvolver.buffer = impulse;
    this.reverbGain = this.audioContext.createGain();
    this.reverbGain.gain.value = 0;
    this.reverbConvolver.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGainNode);
  }

  createInstrumentSound(frequency, instrument) {
    this.init();

    const noteGain = this.audioContext.createGain();
    noteGain.gain.value = 0;

    const filter = this.audioContext.createBiquadFilter();
    filter.type = "lowpass";

    let envelope = { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.5 };
    let filterFreq = 2000;

    // Set instrument-specific parameters
    switch(instrument) {
      case 'piano':
        envelope = { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.8 };
        filterFreq = 3000;
        break;
      case 'guitar':
        envelope = { attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.6 };
        filterFreq = 2500;
        break;
      case 'ukulele':
        envelope = { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.5 };
        filterFreq = 3500;
        break;
      case 'harp':
        envelope = { attack: 0.02, decay: 0.2, sustain: 0.3, release: 1.0 };
        filterFreq = 4000;
        break;
    }

    // Create and setup oscillators
    const osc1 = this.audioContext.createOscillator();
    const osc2 = this.audioContext.createOscillator();
    const waveType = instrumentMap[instrument] || "sine";
    
    osc1.type = waveType;
    osc2.type = waveType;
    osc1.frequency.value = frequency;
    osc2.frequency.value = frequency * 1.003; // slight detune

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(noteGain);
    noteGain.connect(this.masterGainNode);
    noteGain.connect(this.delayNode);
    noteGain.connect(this.reverbConvolver);

    filter.frequency.value = filterFreq;

    // Apply envelope
    const now = this.audioContext.currentTime;
    const attackEnd = now + envelope.attack;
    const decayEnd = attackEnd + envelope.decay;

    noteGain.gain.cancelScheduledValues(now);
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(1.0, attackEnd);
    noteGain.gain.linearRampToValueAtTime(envelope.sustain, decayEnd);

    osc1.start(now);
    osc2.start(now);

    return {
      stop: () => {
        const releaseStart = this.audioContext.currentTime;
        const releaseEnd = releaseStart + envelope.release;
        noteGain.gain.cancelScheduledValues(releaseStart);
        noteGain.gain.setValueAtTime(noteGain.gain.value, releaseStart);
        noteGain.gain.linearRampToValueAtTime(0.0001, releaseEnd);
        setTimeout(() => {
          osc1.stop();
          osc2.stop();
          osc1.disconnect();
          osc2.disconnect();
          filter.disconnect();
          noteGain.disconnect();
        }, envelope.release * 1000 + 50);
      }
    };
  }

  playNote(noteName, octave, instrument) {
    const freq = noteToFrequency(noteName, octave);
    const soundObj = this.createInstrumentSound(freq, instrument);
    return soundObj;
  }

  stopNote(soundObj) {
    if (soundObj && typeof soundObj.stop === 'function') {
      try {
        soundObj.stop();
      } catch (error) {
        console.error('Error stopping sound:', error);
      }
    }
  }

  setDelayGain(value) {
    if (this.delayGain) {
      this.delayGain.gain.value = value;
    }
  }

  setReverbGain(value) {
    if (this.reverbGain) {
      this.reverbGain.gain.value = value;
    }
  }

  playMetronomeClick() {
    if (!this.audioContext) return;
    
    const beepOsc = this.audioContext.createOscillator();
    const beepGain = this.audioContext.createGain();
    beepOsc.frequency.value = 880;
    beepGain.gain.setValueAtTime(0.1, this.audioContext.currentTime);
    beepOsc.connect(beepGain).connect(this.audioContext.destination);
    beepOsc.start(this.audioContext.currentTime);
    beepOsc.stop(this.audioContext.currentTime + 0.05);
  }

  get currentTime() {
    return this.audioContext ? this.audioContext.currentTime : 0;
  }
}

export const audioEngine = new AudioEngine();
