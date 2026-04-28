import * as Tone from 'tone';

const MAJOR_PENTATONIC = ['C', 'D', 'E', 'G', 'A'];
const MINOR_PENTATONIC = ['C', 'Eb', 'F', 'G', 'Bb'];
const CLIP_DURATION = 2.5;

interface FaceParams {
  noteIdx: number;
  octave: number;
  waveform: 'sine' | 'triangle';
  isMajor: boolean;
  pan: number;
  brightness: number;
}

export class AudioCapture {
  async capture(params: FaceParams): Promise<{ blob: Blob; duration: number }> {
    try {
      const buffer = await Tone.Offline(({ transport }) => {
        const scale = params.isMajor ? MAJOR_PENTATONIC : MINOR_PENTATONIC;
        const note = `${scale[params.noteIdx % scale.length]}${params.octave}`;

        const reverb = new Tone.Reverb({ decay: 3, wet: 0.4 }).toDestination();
        const filter = new Tone.Filter(
          Math.min(params.brightness, 3000),
          'lowpass',
          -12,
        ).connect(reverb);
        const gain = new Tone.Gain(0.3).connect(filter);

        const synth = new Tone.Synth({
          oscillator: { type: params.waveform },
          envelope: { attack: 0.8, decay: 0.6, sustain: 0.3, release: 1.5 },
          volume: -12,
        }).connect(gain);

        transport.start(0);
        synth.triggerAttackRelease(note, '1n', 0.1);

        const secondNote = `${scale[(params.noteIdx + 2) % scale.length]}${params.octave}`;
        synth.triggerAttackRelease(secondNote, '2n', 1.2);
      }, CLIP_DURATION);

      const wav = audioBufferToWav(buffer);
      const blob = new Blob([wav], { type: 'audio/wav' });
      return { blob, duration: CLIP_DURATION * 1000 };
    } catch {
      return { blob: new Blob(), duration: 0 };
    }
  }

  isRecording(): boolean {
    return false;
  }

  hasFailedInit(): boolean {
    return false;
  }

  destroy(): void {
    // no resources to clean up
  }
}

function audioBufferToWav(buffer: Tone.ToneAudioBuffer): ArrayBuffer {
  const audioBuffer = buffer.get();
  if (!audioBuffer) return new ArrayBuffer(0);
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = headerSize;
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }

  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return buf;
}
