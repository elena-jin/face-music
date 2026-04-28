import * as Tone from 'tone';
import type { TrackedFace, Participant } from './types';

const MAJOR_PENTATONIC = ['C', 'D', 'E', 'G', 'A'];
const MINOR_PENTATONIC = ['C', 'Eb', 'F', 'G', 'Bb'];
const OCTAVE_RANGE = [3, 4, 5];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

interface LiveVoice {
  synth: Tone.Synth;
  gain: Tone.Gain;
  filter: Tone.Filter;
  lastNote: string;
  nextNoteTime: number;
  fadeTarget: number;
  baseNoteIdx: number;
  baseOctave: number;
  appliedGain: number;
  appliedFreq: number;
}

interface StoredVoice {
  player: Tone.Player;
  gain: Tone.Gain;
  nextPlayTime: number;
}

export class SoundEngine {
  private liveVoices: Map<string, LiveVoice> = new Map();
  private storedVoices: Map<string, StoredVoice> = new Map();
  private reverb: Tone.Reverb | null = null;
  private masterGain: Tone.Gain | null = null;
  private limiter: Tone.Limiter | null = null;
  private started = false;
  private loopId: number | null = null;
  private lastTickTime = 0;
  private userHighlightedIds: Set<string> = new Set();

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();

    this.limiter = new Tone.Limiter(-3).toDestination();
    this.masterGain = new Tone.Gain(0.7).connect(this.limiter);
    this.reverb = new Tone.Reverb({ decay: 3, wet: 0.3 });
    await this.reverb.generate();
    this.reverb.connect(this.masterGain);

    this.started = true;
    this.startLoop();
  }

  private startLoop(): void {
    const tick = () => {
      const now = Tone.now();
      if (now - this.lastTickTime < 0.1) {
        this.loopId = requestAnimationFrame(tick);
        return;
      }
      this.lastTickTime = now;

      for (const [, voice] of this.liveVoices) {
        if (now >= voice.nextNoteTime) {
          try {
            voice.synth.triggerAttackRelease(voice.lastNote, '2n', now);
          } catch { /* ignore */ }
          voice.nextNoteTime = now + 4 + Math.random() * 5;
        }
        const target = voice.fadeTarget * 0.15;
        if (Math.abs(target - voice.appliedGain) > 0.01) {
          voice.appliedGain = target;
          voice.gain.gain.linearRampTo(target, 2);
        }
      }

      for (const [, sv] of this.storedVoices) {
        if (now >= sv.nextPlayTime && sv.player.loaded) {
          try {
            if (sv.player.state !== 'started') {
              sv.player.start(now);
            }
          } catch { /* ignore */ }
          const count = this.storedVoices.size;
          const interval = count > 10 ? 4 + Math.random() * 8 : 5 + Math.random() * 12;
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

      voice.fadeTarget = fade;

      if (face.expression) {
        const { smile, mouthOpen, eyebrowRaise } = face.expression;
        const isMajor = smile > 3.5;
        const scale = isMajor ? MAJOR_PENTATONIC : MINOR_PENTATONIC;

        // Mouth opening shifts note up within scale
        const mouthShift = Math.floor(mouthOpen * 15);
        const noteIdx = (voice.baseNoteIdx + mouthShift) % scale.length;
        const octaveShift = eyebrowRaise > 0.35 ? 1 : 0;
        const octave = Math.min(voice.baseOctave + octaveShift, 5);
        const note = `${scale[noteIdx]}${octave}`;
        if (voice.lastNote !== note) {
          voice.lastNote = note;
        }

        // Smile brightens, eyebrow raise darkens, mouth opening opens filter
        const targetFreq = 500 + smile * 250 + mouthOpen * 600 - eyebrowRaise * 200;
        if (Math.abs(targetFreq - voice.appliedFreq) > 50) {
          voice.appliedFreq = targetFreq;
          voice.filter.frequency.linearRampTo(
            Math.min(Math.max(targetFreq, 300), 2500), 1.5
          );
        }
      }
    }
  }

  async addParticipantSound(participant: Participant, audioUrl: string): Promise<void> {
    if (!this.started || !this.reverb) return;
    if (this.storedVoices.has(participant.id)) return;

    const gain = new Tone.Gain(0).connect(this.reverb!);

    const player = new Tone.Player({
      url: audioUrl,
      loop: false,
      volume: -16,
      fadeIn: 0.5,
      fadeOut: 0.8,
    }).connect(gain);

    try {
      await Tone.loaded();
      const count = this.storedVoices.size + 1;
      const targetGain = Math.max(0.03, 0.15 / Math.sqrt(count));
      gain.gain.linearRampTo(targetGain, 3);

      this.storedVoices.set(participant.id, {
        player,
        gain,
        nextPlayTime: Tone.now() + 2 + Math.random() * 8,
      });

      this.rebalanceStoredVoices();
    } catch {
      try { player.dispose(); } catch { /* */ }
      try { gain.dispose(); } catch { /* */ }
    }
  }

  private rebalanceStoredVoices(): void {
    const count = this.storedVoices.size;
    if (count === 0) return;
    const targetGain = Math.max(0.03, 0.15 / Math.sqrt(count));
    for (const [, sv] of this.storedVoices) {
      sv.gain.gain.linearRampTo(targetGain, 5);
    }
  }

  highlightParticipant(id: string, isUserAction = false): void {
    if (isUserAction) this.userHighlightedIds.add(id);
    const sv = this.storedVoices.get(id);
    if (!sv || !sv.player.loaded) return;
    sv.gain.gain.linearRampTo(0.5, 0.5);
    try {
      if (sv.player.state !== 'started') {
        sv.player.start();
      }
    } catch { /* */ }
  }

  unhighlightParticipant(id: string, isUserAction = false): void {
    if (isUserAction) this.userHighlightedIds.delete(id);
    if (!isUserAction && this.userHighlightedIds.has(id)) return;
    const sv = this.storedVoices.get(id);
    if (!sv) return;
    const count = this.storedVoices.size;
    const targetGain = Math.max(0.03, 0.15 / Math.sqrt(count));
    sv.gain.gain.linearRampTo(targetGain, 1.5);
  }

  private melodyInterval: number | null = null;

  startMelodyPlayback(): void {
    this.stopMelodyPlayback();
    if (this.storedVoices.size === 0) return;
    const ids = [...this.storedVoices.keys()];
    let idx = 0;
    const playNext = () => {
      if (idx > 0) this.unhighlightParticipant(ids[(idx - 1) % ids.length]);
      this.highlightParticipant(ids[idx % ids.length]);
      idx++;
    };
    playNext();
    this.melodyInterval = window.setInterval(playNext, 3000);
  }

  stopMelodyPlayback(): void {
    if (this.melodyInterval !== null) {
      clearInterval(this.melodyInterval);
      this.melodyInterval = null;
      for (const [id] of this.storedVoices) {
        this.unhighlightParticipant(id);
      }
    }
  }

  private createLiveVoice(face: TrackedFace): LiveVoice | null {
    if (!this.reverb) return null;
    const h = hashString(face.id);
    const noteIdx = h % MAJOR_PENTATONIC.length;
    const octave = OCTAVE_RANGE[h % OCTAVE_RANGE.length];
    const note = `${MAJOR_PENTATONIC[noteIdx]}${octave}`;

    const gain = new Tone.Gain(0).connect(this.reverb);
    const filter = new Tone.Filter(1000, 'lowpass', -12).connect(gain);
    const synth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 1.5, decay: 1.0, sustain: 0.3, release: 3.0 },
      volume: -18,
    }).connect(filter);

    return {
      synth, gain, filter,
      lastNote: note,
      nextNoteTime: Tone.now() + 1 + Math.random() * 3,
      fadeTarget: 1,
      baseNoteIdx: noteIdx,
      baseOctave: octave,
      appliedGain: 0,
      appliedFreq: 1000,
    };
  }

  private removeLiveVoice(id: string): void {
    const voice = this.liveVoices.get(id);
    if (!voice) return;
    voice.gain.gain.linearRampTo(0, 2);
    setTimeout(() => {
      try { voice.synth.dispose(); } catch { /* */ }
      try { voice.filter.dispose(); } catch { /* */ }
      try { voice.gain.dispose(); } catch { /* */ }
    }, 3000);
    this.liveVoices.delete(id);
  }

  getLiveVoiceCount(): number {
    return this.liveVoices.size;
  }

  getStoredVoiceCount(): number {
    return this.storedVoices.size;
  }

  stop(): void {
    this.stopMelodyPlayback();
    if (this.loopId !== null) cancelAnimationFrame(this.loopId);
    for (const [, voice] of this.liveVoices) {
      try { voice.synth.dispose(); } catch { /* */ }
      try { voice.filter.dispose(); } catch { /* */ }
      try { voice.gain.dispose(); } catch { /* */ }
    }
    this.liveVoices.clear();
    for (const [, sv] of this.storedVoices) {
      try { sv.player.dispose(); } catch { /* */ }
      try { sv.gain.dispose(); } catch { /* */ }
    }
    this.storedVoices.clear();
    try { this.reverb?.dispose(); } catch { /* */ }
    try { this.limiter?.dispose(); } catch { /* */ }
    try { this.masterGain?.dispose(); } catch { /* */ }
    this.started = false;
  }
}
