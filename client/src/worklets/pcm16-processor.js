// PCM16 24kHz mono frame emitter for the Realtime API.
//
// AudioContext is created at 24kHz upstream so we don't have to resample here;
// we mix to mono, convert Float32 [-1, 1] → Int16 little-endian, and post a
// frame of ~20ms (480 samples) to the main thread. The main thread base64
// encodes and forwards it over Socket.IO as input_audio_buffer.append.

const FRAME_SAMPLES = 480; // 20ms at 24kHz

class Pcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._pending = new Float32Array(0);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0] || new Float32Array(128);
    const ch1 = input[1] || ch0;
    const len = Math.max(ch0.length, ch1.length);
    const mono = new Float32Array(len);
    let sumSquares = 0;
    for (let i = 0; i < len; i++) {
      const m = (ch0[i] + ch1[i]) * 0.5;
      mono[i] = m;
      sumSquares += m * m;
    }
    const rms = Math.sqrt(sumSquares / Math.max(len, 1));
    this.port.postMessage({ type: 'rms', value: rms });

    // Concatenate with pending leftovers.
    const merged = new Float32Array(this._pending.length + mono.length);
    merged.set(this._pending, 0);
    merged.set(mono, this._pending.length);

    // Emit FRAME_SAMPLES-sized PCM16 chunks; keep remainder for next call.
    let offset = 0;
    while (merged.length - offset >= FRAME_SAMPLES) {
      const slice = merged.subarray(offset, offset + FRAME_SAMPLES);
      const pcm = new Int16Array(FRAME_SAMPLES);
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        let s = slice[i];
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage({ type: 'frame', pcm: pcm.buffer }, [pcm.buffer]);
      offset += FRAME_SAMPLES;
    }
    this._pending = merged.slice(offset);
    return true;
  }
}

registerProcessor('pcm16-processor', Pcm16Processor);
