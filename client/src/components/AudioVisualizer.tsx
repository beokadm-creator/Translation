import React, { useEffect, useRef } from "react";

interface Props {
  stream: MediaStream | null;
  width?: number;
  height?: number;
}

const AudioVisualizer: React.FC<Props> = ({ stream, width = 300, height = 50 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafId = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream) return;
    
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
    contextRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasCtx = canvas.getContext("2d");
    if (!canvasCtx) return;

    const draw = () => {
      rafId.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = "#111827"; // gray-900
      canvasCtx.fillRect(0, 0, width, height);

      const barWidth = (width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        canvasCtx.fillStyle = `rgb(${barHeight + 100}, 50, 50)`;
        canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(rafId.current);
      if (ctx.state !== "closed") ctx.close();
    };
  }, [stream, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className="rounded" />;
};

export default AudioVisualizer;
