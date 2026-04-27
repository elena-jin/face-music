const MAX_DURATION_MS = 3000;

export class AudioCapture {
  private stream: MediaStream | null = null;
  private recording = false;
  private pendingResult: Promise<{ blob: Blob; duration: number }> | null = null;
  private initFailed = false;
  private mimeType = 'audio/webm';

  private async ensureStream(): Promise<boolean> {
    if (this.stream) return true;
    if (this.initFailed) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 44100, echoCancellation: true, noiseSuppression: true },
      });
      this.mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      return true;
    } catch {
      this.initFailed = true;
      return false;
    }
  }

  isAvailable(): boolean {
    return this.stream !== null && !this.initFailed;
  }

  hasFailedInit(): boolean {
    return this.initFailed;
  }

  async capture(): Promise<{ blob: Blob; duration: number }> {
    if (this.recording) {
      return { blob: new Blob(), duration: 0 };
    }

    const ready = await this.ensureStream();
    if (!ready || !this.stream) {
      return { blob: new Blob(), duration: 0 };
    }

    this.recording = true;

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    const startTime = Date.now();

    this.pendingResult = new Promise<{ blob: Blob; duration: number }>((resolve) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const duration = Math.min(Date.now() - startTime, MAX_DURATION_MS);
        const blob = new Blob(chunks, { type: this.mimeType });
        this.recording = false;
        this.pendingResult = null;
        resolve({ blob, duration });
      };

      recorder.start(100);

      setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, MAX_DURATION_MS);
    });

    return this.pendingResult;
  }

  isRecording(): boolean {
    return this.recording;
  }

  destroy(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.stream = null;
    this.recording = false;
    this.pendingResult = null;
  }
}
