import { useEffect, useRef, useState } from 'react';
import { Slider } from 'antd';
import { ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import type { AudioSourceType } from '../types/types';

interface Props {
  audioStream: MediaStream | null;
  isRecording: boolean;
  audioSourceType?: AudioSourceType;
}

export const LiveWaveform: React.FC<Props> = ({ audioStream, isRecording, audioSourceType = 'microphone' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const waveformDataRef = useRef<number[]>([]); // Store waveform history
  const lastUpdateTimeRef = useRef<number>(0); // Track last update for throttling
  const [zoom, setZoom] = useState(1); // 1 = 10 minutes visible
  const [scrollPosition, setScrollPosition] = useState(0);

  // Constants for performance calculation
  const MAX_DURATION = 10 * 60; // 10 minutes
  const PIXELS_PER_SECOND = 50;
  const MAX_SAMPLES = MAX_DURATION * PIXELS_PER_SECOND; // 30,000 samples max

  useEffect(() => {
    if (!audioStream || !isRecording || !canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) return;

    // Create audio context and analyser
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(audioStream);
    
    source.connect(analyser);
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const pixelsPerSecond = PIXELS_PER_SECOND;
    const maxWidth = MAX_SAMPLES;

    // Pre-calculate amplification factor based on audio source (avoid recalculating every frame)
    let amplificationFactor = 5; // Default for 'both'
    if (audioSourceType === 'system') {
      amplificationFactor = 10; // 10x for system audio (louder visualization)
    } else if (audioSourceType === 'microphone') {
      amplificationFactor = 3; // 3x for microphone (smaller visualization)
    }

    // Draw waveform with throttling for better performance
    const draw = () => {
      if (!analyser || !dataArray || !canvasContext) return;

      animationIdRef.current = requestAnimationFrame(draw);

      // Throttle updates to ~20fps (every 50ms) instead of 60fps to reduce CPU usage
      const now = performance.now();
      if (now - lastUpdateTimeRef.current < 50) {
        return; // Skip this frame
      }
      lastUpdateTimeRef.current = now;

      analyser.getByteTimeDomainData(dataArray);

      // Calculate average amplitude for this frame
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (dataArray[i] - 128) / 128; // -1 to 1
        sum += Math.abs(normalized);
      }
      const avgAmplitude = sum / bufferLength;
      
      waveformDataRef.current.push(avgAmplitude * amplificationFactor);

      // Limit history to maxWidth (prevents memory leak for long recordings)
      if (waveformDataRef.current.length > maxWidth) {
        waveformDataRef.current.shift();
      }

      // Clear canvas
      canvasContext.fillStyle = 'rgb(20, 20, 20)';
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);

      // Calculate visible range based on zoom and scroll
      const visibleWidth = canvas.width / zoom;
      const totalDataPoints = waveformDataRef.current.length;
      const startIndex = Math.floor((totalDataPoints - visibleWidth) * scrollPosition);
      const endIndex = Math.min(startIndex + visibleWidth, totalDataPoints);

      // Auto-scroll to end if at the end
      if (scrollPosition > 0.95 || totalDataPoints < visibleWidth) {
        setScrollPosition(1);
      }

      // Draw waveform bars
      canvasContext.fillStyle = '#1890ff';
      const barWidth = (canvas.width / visibleWidth) * zoom;
      
      for (let i = startIndex; i < endIndex; i++) {
        const amplitude = waveformDataRef.current[i];
        const barHeight = amplitude * canvas.height * 0.9; // Use 90% of canvas height
        const x = ((i - startIndex) / visibleWidth) * canvas.width;
        const y = (canvas.height - barHeight) / 2;
        
        canvasContext.fillRect(x, y, Math.max(barWidth, 1), barHeight);
      }

      // Draw center line
      canvasContext.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      canvasContext.lineWidth = 1;
      canvasContext.beginPath();
      canvasContext.moveTo(0, canvas.height / 2);
      canvasContext.lineTo(canvas.width, canvas.height / 2);
      canvasContext.stroke();

      // Draw time markers
      const secondsVisible = visibleWidth / pixelsPerSecond;
      const markerInterval = secondsVisible > 120 ? 60 : secondsVisible > 60 ? 30 : 10; // seconds
      const totalSeconds = totalDataPoints / pixelsPerSecond;
      
      canvasContext.fillStyle = 'rgba(255, 255, 255, 0.5)';
      canvasContext.font = '10px monospace';
      
      for (let sec = 0; sec <= totalSeconds; sec += markerInterval) {
        const dataIndex = sec * pixelsPerSecond;
        if (dataIndex >= startIndex && dataIndex <= endIndex) {
          const x = ((dataIndex - startIndex) / visibleWidth) * canvas.width;
          canvasContext.fillText(formatTime(sec), x + 2, 12);
          
          // Draw marker line
          canvasContext.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          canvasContext.beginPath();
          canvasContext.moveTo(x, 0);
          canvasContext.lineTo(x, canvas.height);
          canvasContext.stroke();
        }
      }
    };

    draw();

    // Cleanup
    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [audioStream, isRecording, zoom, scrollPosition]);

  // Reset waveform data when recording stops
  useEffect(() => {
    if (!isRecording) {
      waveformDataRef.current = [];
      setScrollPosition(0);
    }
  }, [isRecording]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Use native event listener to prevent page scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isRecording) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.2 : 0.2; // Scroll down = zoom out, scroll up = zoom in
      setZoom(prev => Math.max(0.5, Math.min(5, prev + delta)));
    };

    // Add event listener with passive: false to allow preventDefault
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [isRecording]);

  if (!isRecording) {
    return null;
  }

  return (
    <div style={{ 
      width: '100%', 
      marginTop: '12px',
      padding: '12px',
      backgroundColor: '#1a1a1a',
      borderRadius: '8px',
      border: '1px solid #434343'
    }}>
      <div style={{ 
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px'
      }}>
        <div style={{ 
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{ 
            color: '#fff', 
            fontSize: '13px',
            fontWeight: 600 
          }}>
            🎙️ Live Waveform
          </div>
          {/* Performance info */}
          <div style={{ 
            color: '#666', 
            fontSize: '11px'
          }}>
            {waveformDataRef.current.length.toLocaleString()} samples
            {waveformDataRef.current.length >= MAX_SAMPLES && ' (max)'}
          </div>
        </div>
        
        {/* Zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ZoomOutOutlined 
            style={{ color: '#999', cursor: 'pointer' }}
            onClick={() => setZoom(Math.max(0.5, zoom - 0.5))}
          />
          <span style={{ color: '#999', fontSize: '12px', minWidth: '60px', textAlign: 'center' }}>
            {zoom === 1 ? '10 min' : zoom === 0.5 ? '20 min' : `${(10 / zoom).toFixed(0)} min`}
          </span>
          <ZoomInOutlined 
            style={{ color: '#999', cursor: 'pointer' }}
            onClick={() => setZoom(Math.min(5, zoom + 0.5))}
          />
        </div>
      </div>

      <div 
        ref={containerRef}
        style={{ 
          position: 'relative',
          width: '100%',
          height: '80px',
          backgroundColor: '#141414',
          borderRadius: '4px',
          overflow: 'hidden',
          cursor: 'ns-resize' // Indicate zoom capability
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block'
          }}
        />
      </div>

      {/* Scroll slider */}
      {waveformDataRef.current.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={scrollPosition}
            onChange={setScrollPosition}
            tooltip={{ formatter: null }}
            trackStyle={{ backgroundColor: '#1890ff' }}
            railStyle={{ backgroundColor: '#434343' }}
          />
        </div>
      )}
    </div>
  );
};
