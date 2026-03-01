export class VADRecorder {
  private audioContext: AudioContext;
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;
  private silenceStart: number = Date.now();
  private isSpeaking: boolean = false;
  private onSilence: () => void;
  private animationFrameId: number | null = null;

  constructor(stream: MediaStream, onSilence: () => void) {
    // Type cast for webkitAudioContext browser compatibility
    type AudioContextConstructor = typeof AudioContext;
    const WindowWithAudioContext = window as Window & { webkitAudioContext?: AudioContextConstructor };
    const AudioContextCtor = window.AudioContext || WindowWithAudioContext.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('AudioContext not supported');
    this.audioContext = new AudioContextCtor();
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048; // Precision
    source.connect(this.analyser);
    this.dataArray = new Uint8Array(this.analyser.fftSize);
    this.onSilence = onSilence;
    this.checkVolume();
  }

  private checkVolume = () => {
    // Type cast to avoid ArrayBufferLike mismatch issues with strict TypeScript
    this.analyser.getByteTimeDomainData(this.dataArray as Uint8Array & ArrayBufferLike);

    // RMS(Root Mean Square) calculation
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const x = (this.dataArray[i] - 128) / 128.0;
      sum += x * x;
    }
    const rms = Math.sqrt(sum / this.dataArray.length);
    const THRESHOLD = 0.02; // Sensitivity threshold
    const SILENCE_DURATION = 600; // 0.6s silence to trigger cut

    if (rms > THRESHOLD) {
      this.isSpeaking = true;
      this.silenceStart = Date.now(); // Reset timer on sound
    } else {
      if (this.isSpeaking && Date.now() - this.silenceStart > SILENCE_DURATION) {
        // Spoke then silence for 0.6s -> End of sentence!
        this.isSpeaking = false;
        this.onSilence(); // Trigger
      }
    }
    this.animationFrameId = requestAnimationFrame(this.checkVolume);
  };

  public destroy() {
      if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
      this.audioContext.close();
  }
}
