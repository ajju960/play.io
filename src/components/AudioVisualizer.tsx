import { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  audioElement: HTMLAudioElement | null;
  isPlaying: boolean;
}

export default function AudioVisualizer({ audioElement, isPlaying }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  useEffect(() => {
    if (!audioElement || !canvasRef.current) return;

    // Initialize AudioContext lazily on user gesture/play
    const initAudio = () => {
      try {
        if (!audioContextRef.current) {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const ctx = new AudioContextClass();
          audioContextRef.current = ctx;

          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyserRef.current = analyser;

          // Connect audio source
          const source = ctx.createMediaElementSource(audioElement);
          source.connect(analyser);
          analyser.connect(ctx.destination);
          sourceRef.current = source;
        }

        if (audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume();
        }
      } catch (err) {
        console.warn('AudioVisualizer initialization error:', err);
      }
    };

    if (isPlaying) {
      initAudio();
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserRef.current ? analyserRef.current.frequencyBinCount : 128;
    const dataArray = new Uint8Array(bufferLength);

    const renderFrame = () => {
      animationRef.current = requestAnimationFrame(renderFrame);

      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      // Create rich background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, '#09090b');
      bgGrad.addColorStop(1, '#18181b');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      if (analyserRef.current && isPlaying) {
        analyserRef.current.getByteFrequencyData(dataArray);
      } else {
        // Mock static sine wave if not playing/loaded
        for (let i = 0; i < bufferLength; i++) {
          dataArray[i] = Math.sin(i * 0.1 + Date.now() * 0.005) * 15 + 20;
        }
      }

      const barWidth = (width / bufferLength) * 1.6;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i];

        // Soft visual scale
        const scale = height / 255;
        const h = barHeight * scale * 0.75;

        // Interactive neon color gradient
        const barGrad = ctx.createLinearGradient(0, height, 0, height - h);
        barGrad.addColorStop(0, '#a855f7'); // Purple
        barGrad.addColorStop(0.5, '#ec4899'); // Pink
        barGrad.addColorStop(1, '#06b6d4'); // Cyan

        ctx.fillStyle = barGrad;
        
        // Draw elegant rounded bars
        const y = height - h;
        const radius = barWidth / 2;
        
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
        ctx.lineTo(x + barWidth, height);
        ctx.closePath();
        ctx.fill();

        x += barWidth + 2;
      }

      // Add a subtle center circular visual overlay
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 40, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(24, 24, 27, 0.4)';
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.3)';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      // Pulsing pulse circle
      let avgFreq = 0;
      if (isPlaying && analyserRef.current) {
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        avgFreq = sum / bufferLength;
      }
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 40 + (avgFreq * 0.15), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.2)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    renderFrame();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [audioElement, isPlaying]);

  // Clean up Audio Nodes on Unmount
  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <div id="audio-visualizer-container" className="relative w-full h-48 md:h-64 rounded-xl overflow-hidden border border-zinc-800 shadow-2xl">
      <canvas 
        ref={canvasRef} 
        width={600} 
        height={250} 
        className="w-full h-full block"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none bg-gradient-to-t from-zinc-950/80 to-transparent">
        <span className="font-sans font-medium text-sm text-zinc-100 tracking-wide uppercase">PLAY.IO Audio Stage</span>
        <span className="font-mono text-[10px] text-zinc-400 mt-1">Responsive Frequency Fields</span>
      </div>
    </div>
  );
}
