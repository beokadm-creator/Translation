import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  stream: MediaStream | null;
  width?: number;
  height?: number;
  barColor?: string;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ 
  stream, 
  width = 300, 
  height = 50,
  barColor = '#3B82F6' // blue-500
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    if (!stream || !canvasRef.current) return;

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64; // Low resolution for simple bars
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    analyserRef.current = analyser;
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, width, height);

      const barWidth = (width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * height;

        ctx.fillStyle = barColor;
        ctx.fillRect(x, height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioContext.state !== 'closed') audioContext.close();
    };
  }, [stream, width, height, barColor]);

  if (!stream) {
    return (
      <div 
        style={{ width, height }} 
        className="bg-gray-100 rounded flex items-center justify-center text-gray-400 text-xs"
      >
        No Audio
      </div>
    );
  }

  return <canvas ref={canvasRef} width={width} height={height} className="rounded" />;
};

export default AudioVisualizer;
