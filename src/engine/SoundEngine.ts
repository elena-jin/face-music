import * as Tone from 'tone';
import type { TrackedFace } from './types';

const PENTATONIC = ['C', 'D', 'E', 'G', 'A'];
const OCTAVE_RANGE = [3, 4, 5, 6];

interface FaceVoice {
  synth: Tone.Synth;
  panner: Tone.Panner;
  filter: Tone.Filter;
  gain: Tone.Gain;
  lastNote: string;
  nextNoteTime: number;
  fadeTarget: number;
}

export class SoundEngine {
  private voices: Map<string, FaceVoice> = new Map();
  private reverb: Tone.Reverb | null = null;
  private compressor: Tone.Compressor | null = null;
  private masterGain: Tone.Gain | null = null;
  private started = false;
  private loopId: number | null = null;
  private droneOsc: Tone.Oscillator | null = null;
  private droneFilter: Tone.Filter | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();

    this.compressor = new Tone.Compressor(-24, 4).toDestination();
    this.masterGain = new Tone.Gain(0.7).connect(this.compressor);
    this.reverb = new Tone.Reverb({ decay: 4, wet: 0.35 });
    await this.reverb.generate();
    this.reverb.connect(this.masterGain);

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
      for (const [, voice] of this.voices) {
        if (now >= voice.nextNoteTime) {
          voice.synth.triggerAttackRelease(voice.lastNote, '4n', now);
          const interval = 1.5 + Math.random() * 2.5;
          voice.nextNoteTime = now + interval;
        }
        voice.gain.gain.rampTo(voice.fadeTarget * 0.15, 0.3);
      }
      this.loopId = requestAnimationFrame(tick);
    };
    this.loopId = requestAnimationFrame(tick);
  }

  update(faces: TrackedFace[], getFade: (f: TrackedFace) => number): void {
    if (!this.started || !this.reverb) return;

    const activeFaceIds = new Set(faces.map((f) => f.id));

    for (const [id] of this.voices) {
      if (!activeFaceIds.has(id)) {
        this.removeVoice(id);
      }
    }

    const activeCount = faces.filter((f) => f.active).length;

    if (this.droneFilter) {
      const freq = 120 + activeCount * 40;
      this.droneFilter.frequency.rampTo(Math.min(freq, 400), 1);
    }

    for (const face of faces) {
      const fade = getFade(face);
      if (fade <= 0) {
        this.removeVoice(face.id);
        continue;
      }

      let voice = this.voices.get(face.id);
      if (!voice) {
        const created = this.createVoice(face);
        if (!created) continue;
        voice = created;
        this.voices.set(face.id, voice);
      }

      voice.panner.pan.rampTo((face.centerX - 0.5) * 1.6, 0.2);

      const octaveIdx = Math.floor(face.centerY * OCTAVE_RANGE.length);
      const octave = OCTAVE_RANGE[Math.min(octaveIdx, OCTAVE_RANGE.length - 1)];
      const noteIdx = Math.floor(((face.centerX + face.centerY) * 2.5) % PENTATONIC.length);
      voice.lastNote = `${PENTATONIC[noteIdx]}${octave}`;

      const brightness = 400 + face.velocity * 8000 + (1 - face.faceWidth) * 2000;
      voice.filter.frequency.rampTo(Math.min(brightness, 6000), 0.3);

      voice.fadeTarget = fade;
    }
  }

  private createVoice(face: TrackedFace): FaceVoice | null {
    if (!this.reverb) return null;

    const waveforms = ['sine', 'triangle', 'sine'] as const;
    const waveIdx = parseInt(face.id.replace('face-', ''), 10) % waveforms.length;

    const gain = new Tone.Gain(0);
    const panner = new Tone.Panner(0).connect(gain);
    const filter = new Tone.Filter(1500, 'lowpass').connect(panner);
    gain.connect(this.reverb);

    const synth = new Tone.Synth({
      oscillator: { type: waveforms[waveIdx] as 'sine' | 'triangle' },
      envelope: { attack: 0.8, decay: 0.4, sustain: 0.3, release: 2.5 },
      volume: -18,
    }).connect(filter);

    const octave = OCTAVE_RANGE[Math.floor(face.centerY * OCTAVE_RANGE.length)] ?? 4;
    const noteIdx = Math.floor(face.centerX * PENTATONIC.length);
    const note = `${PENTATONIC[noteIdx % PENTATONIC.length]}${octave}`;

    return {
      synth,
      panner,
      filter,
      gain,
      lastNote: note,
      nextNoteTime: Tone.now() + Math.random() * 2,
      fadeTarget: 1,
    };
  }

  private removeVoice(id: string): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    voice.gain.gain.rampTo(0, 1.5);
    setTimeout(() => {
      voice.synth.dispose();
      voice.panner.dispose();
      voice.filter.dispose();
      voice.gain.dispose();
    }, 2000);
    this.voices.delete(id);
  }

  getVoiceCount(): number {
    return this.voices.size;
  }

  stop(): void {
    if (this.loopId !== null) cancelAnimationFrame(this.loopId);
    for (const [id] of this.voices) {
      this.removeVoice(id);
    }
    this.droneOsc?.stop();
    this.droneOsc?.dispose();
    this.droneFilter?.dispose();
    this.reverb?.dispose();
    this.compressor?.dispose();
    this.masterGain?.dispose();
    this.started = false;
  }
}
