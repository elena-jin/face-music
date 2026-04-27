import * as Tone from 'tone';
import type { TrackedFace, Participant } from './types';

const PENTATONIC = ['C', 'D', 'E', 'G', 'A'];
const OCTAVE_RANGE = [3, 4, 5, 6];

interface LiveVoice {
  synth: Tone.Synth;
  panner: Tone.Panner;
  filter: Tone.Filter;
  gain: Tone.Gain;
  lastNote: string;
  nextNoteTime: number;
  fadeTarget: number;
}

interface StoredVoice {
  player: Tone.Player;
  panner: Tone.Panner;
  gain: Tone.Gain;
  filter: Tone.Filter;
  nextPlayTime: number;
  baseVolume: number;
}

export class SoundEngine {
  private liveVoices: Map<string, LiveVoice> = new Map();
  private storedVoices: Map<string, StoredVoice> = new Map();
  private reverb: Tone.Reverb | null = null;
  private compressor: Tone.Compressor | null = null;
  private masterGain: Tone.Gain | null = null;
  private started = false;
  private loopId: number | null = null;
  private droneOsc: Tone.Oscillator | null = null;
  private droneFilter: Tone.Filter | null = null;
  private chorus: Tone.Chorus | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();

    this.compressor = new Tone.Compressor(-24, 4).toDestination();
    this.masterGain = new Tone.Gain(0.7).connect(this.compressor);
    this.reverb = new Tone.Reverb({ decay: 6, wet: 0.45 });
    await this.reverb.generate();
    this.reverb.connect(this.masterGain);

    this.chorus = new Tone.Chorus({ frequency: 0.3, delayTime: 3.5, depth: 0.4, wet: 0.2 });
    this.chorus.connect(this.masterGain);
    this.chorus.start();

    this.droneFilter = new Tone.Filter(200, 'lowpass').connect(this.masterGain);
    this.droneOsc = new Tone.Oscillator({ frequency: 'C2', type: 'sine', volume: -28 });
    this.droneOsc.connect(this.droneFilter);
    this.droneOsc.start();

    this.started = true;
    this.startLoop();
  }

  private startLoop(): void {
    const tick = () => {
      const now = Tone.now();

      for (const [, voice] of this.liveVoices) {
        if (now >= voice.nextNoteTime) {
          voice.synth.triggerAttackRelease(voice.lastNote, '4n', now);
          const interval = 1.5 + Math.random() * 2.5;
          voice.nextNoteTime = now + interval;
        }
        voice.gain.gain.rampTo(voice.fadeTarget * 0.15, 0.3);
      }

      for (const [, sv] of this.storedVoices) {
        if (now >= sv.nextPlayTime && sv.player.loaded) {
          try {
            if (sv.player.state !== 'started') {
              sv.player.start(now);
            }
          } catch {
            // player may not be ready
          }
          const interval = 6 + Math.random() * 18;
          sv.nextPlayTime = now + interval;
        }
      }

      this.loopId = requestAnimationFrame(tick);
    };
    this.loopId = requestAnimationFrame(tick);
  }

  updateLiveFaces(faces: TrackedFace[], getFade: (f: TrackedFace) => number): void {
    if (!this.started || !this.reverb) return;

    const activeFaceIds = new Set(faces.map((f) => f.id));

    for (const [id] of this.liveVoices) {
      if (!activeFaceIds.has(id)) {
        this.removeLiveVoice(id);
      }
    }

    const activeCount = faces.filter((f) => f.active).length;
    if (this.droneFilter) {
      const freq = 120 + activeCount * 40 + this.storedVoices.size * 5;
      this.droneFilter.frequency.rampTo(Math.min(freq, 600), 1);
    }

    for (const face of faces) {
      const fade = getFade(face);
      if (fade <= 0) {
        this.removeLiveVoice(face.id);
        continue;
      }

      let voice = this.liveVoices.get(face.id);
      if (!voice) {
        const created = this.createLiveVoice(face);
        if (!created) continue;
        voice = created;
        this.liveVoices.set(face.id, voice);
      }

      voice.panner.pan.rampTo((face.centerX - 0.5) * 1.6, 0.2);
      const octaveIdx = Math.floor(face.centerY * OCTAVE_RANGE.length);
      const octave = OCTAVE_RANGE[Math.min(octaveIdx, OCTAVE_RANGE.length - 1)];
      const noteIdx = Math.floor(((face.centerX + face.centerY) * 2.5) % PENTATONIC.length);
      voice.lastNote = `${PENTATONIC[noteIdx]}${octave}`;
      const brightness = 400 + face.velocity * 4000 + (1 - face.faceWidth) * 1500;
      voice.filter.frequency.rampTo(Math.min(brightness, 4000), 0.5);
      voice.fadeTarget = fade;
    }
  }

  async addParticipantSound(participant: Participant, audioUrl: string): Promise<void> {
    if (!this.started || !this.reverb) return;
    if (this.storedVoices.has(participant.id)) return;

    const totalCount = this.storedVoices.size + 1;
    const baseVol = Math.max(-40, -18 - totalCount * 0.5);

    const gain = new Tone.Gain(0);
    const panner = new Tone.Panner((participant.centerX - 0.5) * 1.4).connect(gain);
    const filter = new Tone.Filter(1800, 'lowpass', -12).connect(panner);
    gain.connect(this.reverb);
    if (this.chorus && totalCount % 3 === 0) {
      gain.connect(this.chorus);
    }

    const player = new Tone.Player({
      url: audioUrl,
      loop: false,
      volume: baseVol,
      fadeIn: 1.2,
      fadeOut: 1.5,
    }).connect(filter);

    try {
      await Tone.loaded();

      gain.gain.rampTo(0.10, 4);

      this.storedVoices.set(participant.id, {
        player,
        panner,
        gain,
        filter,
        nextPlayTime: Tone.now() + Math.random() * 5,
        baseVolume: baseVol,
      });

      this.rebalanceStoredVoices();
    } catch {
      try { player.dispose(); } catch { /* ignore */ }
      try { filter.dispose(); } catch { /* ignore */ }
      try { panner.dispose(); } catch { /* ignore */ }
      try { gain.dispose(); } catch { /* ignore */ }
    }
  }

  private rebalanceStoredVoices(): void {
    const count = this.storedVoices.size;
    if (count === 0) return;

    const targetGain = Math.max(0.015, 0.12 / Math.sqrt(count));

    for (const [, sv] of this.storedVoices) {
      sv.gain.gain.rampTo(targetGain, 5);
    }
  }

  highlightParticipant(id: string): void {
    const sv = this.storedVoices.get(id);
    if (!sv || !sv.player.loaded) return;
    sv.gain.gain.rampTo(0.4, 0.3);
    sv.filter.frequency.rampTo(6000, 0.3);
    try {
      if (sv.player.state !== 'started') {
        sv.player.start();
      }
    } catch {
      // ignore
    }
  }

  unhighlightParticipant(id: string): void {
    const sv = this.storedVoices.get(id);
    if (!sv) return;
    const count = this.storedVoices.size;
    const targetGain = Math.max(0.015, 0.12 / Math.sqrt(count));
    sv.gain.gain.rampTo(targetGain, 1);
    sv.filter.frequency.rampTo(2000, 1);
  }

  private createLiveVoice(face: TrackedFace): LiveVoice | null {
    if (!this.reverb) return null;
    const waveforms = ['sine', 'triangle', 'sine'] as const;
    const waveIdx = parseInt(face.id.replace('face-', ''), 10) % waveforms.length;

    const gain = new Tone.Gain(0);
    const panner = new Tone.Panner(0).connect(gain);
    const filter = new Tone.Filter(1500, 'lowpass').connect(panner);
    gain.connect(this.reverb);

    const synth = new Tone.Synth({
      oscillator: { type: waveforms[waveIdx] as 'sine' | 'triangle' },
      envelope: { attack: 1.2, decay: 0.8, sustain: 0.25, release: 3.5 },
      volume: -22,
    }).connect(filter);

    const octave = OCTAVE_RANGE[Math.floor(face.centerY * OCTAVE_RANGE.length)] ?? 4;
    const noteIdx = Math.floor(face.centerX * PENTATONIC.length);
    const note = `${PENTATONIC[noteIdx % PENTATONIC.length]}${octave}`;

    return {
      synth, panner, filter, gain,
      lastNote: note,
      nextNoteTime: Tone.now() + Math.random() * 2,
      fadeTarget: 1,
    };
  }

  private removeLiveVoice(id: string): void {
    const voice = this.liveVoices.get(id);
    if (!voice) return;
    voice.gain.gain.rampTo(0, 1.5);
    setTimeout(() => {
      voice.synth.dispose();
      voice.panner.dispose();
      voice.filter.dispose();
      voice.gain.dispose();
    }, 2000);
    this.liveVoices.delete(id);
  }

  getLiveVoiceCount(): number {
    return this.liveVoices.size;
  }

  getStoredVoiceCount(): number {
    return this.storedVoices.size;
  }

  stop(): void {
    if (this.loopId !== null) cancelAnimationFrame(this.loopId);
    for (const [, voice] of this.liveVoices) {
      voice.synth.dispose();
      voice.panner.dispose();
      voice.filter.dispose();
      voice.gain.dispose();
    }
    this.liveVoices.clear();
    for (const [, sv] of this.storedVoices) {
      sv.player.dispose();
      sv.panner.dispose();
      sv.filter.dispose();
      sv.gain.dispose();
    }
    this.storedVoices.clear();
    this.droneOsc?.stop();
    this.droneOsc?.dispose();
    this.droneFilter?.dispose();
    this.chorus?.dispose();
    this.reverb?.dispose();
    this.compressor?.dispose();
    this.masterGain?.dispose();
    this.started = false;
  }
}
