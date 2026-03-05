import { useEffect, useRef, useState } from "react";
import { Slider } from "antd";
import { ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import type { AudioSourceType } from "../types/types";

interface Props {
  audioStream: MediaStream | null;
  isRecording: boolean;
  audioSourceType?: AudioSourceType;
}

export const LiveWaveform: React.FC<Props> = ({
  audioStream,
  isRecording,
  audioSourceType = "microphone",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const waveformDataRef = useRef<number[]>([]); // Store waveform amplitude history
  const waveformTimesRef = useRef<number[]>([]); // ms from recording start for each sample
  const lastUpdateTimeRef = useRef<number>(0); // Track last update for throttling
  const recordingRealStartRef = useRef<number>(0); // performance.now() when first sample captured
  const droppedSamplesRef = useRef<number>(0); // Samples shifted off the front (for long recordings)
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
    const canvasContext = canvas.getContext("2d");
    if (!canvasContext) return;

    // Create audio context and analyser
    const audioContext = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
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

    // const pixelsPerSecond = PIXELS_PER_SECOND;
    const maxWidth = MAX_SAMPLES;

    // Pre-calculate amplification factor based on audio source (avoid recalculating every frame)
    let amplificationFactor = 5; // Default for 'both'
    if (audioSourceType === "system") {
      amplificationFactor = 10; // 10x for system audio (louder visualization)
    } else if (audioSourceType === "microphone") {
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

      // Track real start time on first sample
      if (waveformDataRef.current.length === 0) {
        recordingRealStartRef.current = now;
      }
      const sampleTimeMs = now - recordingRealStartRef.current;
      waveformDataRef.current.push(avgAmplitude * amplificationFactor);
      waveformTimesRef.current.push(sampleTimeMs);

      // Limit history to maxWidth (prevents memory leak for long recordings)
      if (waveformDataRef.current.length > maxWidth) {
        waveformDataRef.current.shift();
        waveformTimesRef.current.shift();
        droppedSamplesRef.current += 1;
      }

      // Clear canvas
      canvasContext.fillStyle = "rgb(255, 255, 255)";
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);

      // Calculate visible range based on zoom and scroll
      const visibleWidth = canvas.width / zoom;
      const totalDataPoints = waveformDataRef.current.length;
      const startIndex = Math.floor(
        (totalDataPoints - visibleWidth) * scrollPosition,
      );
      const endIndex = Math.min(startIndex + visibleWidth, totalDataPoints);

      // Auto-scroll to end if at the end
      if (scrollPosition > 0.95 || totalDataPoints < visibleWidth) {
        setScrollPosition(1);
      }

      // Draw waveform bars
      canvasContext.fillStyle = "#e71212";
      const barWidth = (canvas.width / visibleWidth) * zoom;

      for (let i = startIndex; i < endIndex; i++) {
        const amplitude = waveformDataRef.current[i];
        const barHeight = amplitude * canvas.height * 0.9; // Use 90% of canvas height
        const x = ((i - startIndex) / visibleWidth) * canvas.width;
        const y = (canvas.height - barHeight) / 2;

        canvasContext.fillRect(x, y, Math.max(barWidth, 1), barHeight);
      }

      // Draw center line
      canvasContext.strokeStyle = "rgba(0, 0, 0, 0.1)";
      canvasContext.lineWidth = 1;
      canvasContext.beginPath();
      canvasContext.moveTo(0, canvas.height / 2);
      canvasContext.lineTo(canvas.width, canvas.height / 2);
      canvasContext.stroke();

      // Draw time markers using exact sample timestamps (binary search)
      const totalMs =
        waveformTimesRef.current.length > 0
          ? waveformTimesRef.current[waveformTimesRef.current.length - 1]
          : 0;
      const totalSeconds = totalMs / 1000;
      // const markerInterval = totalSeconds > 120 ? 60 : 30; // seconds
      const markerInterval = 30; // seconds

      canvasContext.fillStyle = "black";
      canvasContext.font = "10px monospace";

      // Draw 0:00 label at the very first sample if visible
      if (startIndex === 0 || startIndex <= 0) {
        const x = ((0 - startIndex) / visibleWidth) * canvas.width;
        if (x >= 0 && x <= canvas.width) {
          canvasContext.fillText("0:00", x + 2, 12);
          canvasContext.strokeStyle = "rgba(0, 0, 0, 0.12)";
          canvasContext.beginPath();
          canvasContext.moveTo(x, 0);
          canvasContext.lineTo(x, canvas.height);
          canvasContext.stroke();
        }
      }

      for (
        let sec = markerInterval;
        sec <= totalSeconds;
        sec += markerInterval
      ) {
        const targetMs = sec * 1000;
        // Binary search for the sample closest to targetMs
        let lo = 0,
          hi = waveformTimesRef.current.length - 1,
          best = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (waveformTimesRef.current[mid] <= targetMs) {
            best = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        if (best < 0) continue;
        const dataIndex = best; // index in current waveformDataRef array
        if (dataIndex >= startIndex && dataIndex <= endIndex) {
          const x = ((dataIndex - startIndex) / visibleWidth) * canvas.width;
          canvasContext.fillText(formatTime(sec), x + 2, 12);
          canvasContext.strokeStyle = "rgba(0, 0, 0, 0.12)";
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
      waveformTimesRef.current = [];
      recordingRealStartRef.current = 0;
      droppedSamplesRef.current = 0;
      setScrollPosition(0);
    }
  }, [isRecording]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Use native event listener to prevent page scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isRecording) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.2 : 0.2; // Scroll down = zoom out, scroll up = zoom in
      setZoom((prev) => Math.max(0.5, Math.min(5, prev + delta)));
    };

    // Add event listener with passive: false to allow preventDefault
    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [isRecording]);

  if (!isRecording) {
    return null;
  }

  return (
    <div
      style={{
        width: "100%",
        marginTop: "12px",
        padding: "14px 16px",
        backgroundColor: "#ffffff",
        borderRadius: "10px",
        border: "1px solid #e5e7eb",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            style={{
              color: "#020b20",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            🎙️ Live Waveform
          </div>
          {/* Performance info */}
          <div
            style={{
              color: "#6b7280",
              fontSize: "11px",
            }}
          >
            {waveformDataRef.current.length.toLocaleString()} samples
            {waveformDataRef.current.length >= MAX_SAMPLES && " (max)"}
          </div>
        </div>

        {/* Zoom controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ZoomOutOutlined
            style={{ color: "#6b7280", cursor: "pointer" }}
            onClick={() => setZoom(Math.max(0.5, zoom - 0.5))}
          />
          <span
            style={{
              color: "#6b7280",
              fontSize: "12px",
              minWidth: "60px",
              textAlign: "center",
            }}
          >
            {zoom === 1
              ? "10 min"
              : zoom === 0.5
                ? "20 min"
                : `${(10 / zoom).toFixed(0)} min`}
          </span>
          <ZoomInOutlined
            style={{ color: "#6b7280", cursor: "pointer" }}
            onClick={() => setZoom(Math.min(5, zoom + 0.5))}
          />
        </div>
      </div>

      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: "80px",
          backgroundColor: "#ffffff",
          borderRadius: "4px",
          overflow: "hidden",
          cursor: "ns-resize", // Indicate zoom capability
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
          }}
        />
      </div>

      {/* Scroll slider */}
      {waveformDataRef.current.length > 0 && (
        <div style={{ marginTop: "8px" }}>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={scrollPosition}
            onChange={setScrollPosition}
            tooltip={{ formatter: null }}
            trackStyle={{ backgroundColor: "#6366f1" }}
            railStyle={{ backgroundColor: "#ebe5e8" }}
          />
        </div>
      )}
    </div>
  );
};
