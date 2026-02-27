class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.bufferSize = 4096;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0] || new Float32Array(128);
    const ch1 = input[1] || ch0;
    const len = Math.max(ch0.length, ch1.length);
    const mix = new Float32Array(len);
    for (let i = 0; i < len; i++) mix[i] = (ch0[i] + ch1[i]) * 0.5;
    let sum = 0;
    for (let i = 0; i < len; i++) sum += mix[i] * mix[i];
    const rms = Math.sqrt(sum / len);
    this.port.postMessage({ type: 'rms', value: rms });
    this.buffer.push(mix);
    let total = 0;
    for (let i = 0; i < this.buffer.length; i++) total += this.buffer[i].length;
    if (total >= this.bufferSize) {
      const merged = new Float32Array(total);
      let o = 0;
      for (let i = 0; i < this.buffer.length; i++) { merged.set(this.buffer[i], o); o += this.buffer[i].length; }
      this.buffer = [];
      this.port.postMessage({ type: 'chunk', data: merged }, [merged.buffer]);
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
