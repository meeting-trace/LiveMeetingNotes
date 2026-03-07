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
  const animationIdRef = useRef<number | null>(null);
  const waveformDataRef = useRef<number[]>([]); // Store waveform amplitude history
  const waveformTimesRef = useRef<number[]>([]); // ms from recording start for each sample
  const recordingRealStartRef = useRef<number>(0); // performance.now() when first sample captured
  const droppedSamplesRef = useRef<number>(0); // Samples shifted off the front (for long recordings)
  const zoomRef = useRef(1);
  const scrollPositionRef = useRef(0);
  const [zoom, setZoom] = useState(1); // 1 = 10 minutes visible
  const [scrollPosition, setScrollPosition] = useState(0);

  // Keep refs in sync with state
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    scrollPositionRef.current = scrollPosition;
  }, [scrollPosition]);

  // Constants for performance calculation
  const MAX_DURATION = 4 * 60 * 60; // 4 hours — đủ cho mọi cuộc họp dài
  const SAMPLE_RATE = 1; // 1 sample/giây — khớp với browser throttle khi tab ẩn
  const MAX_SAMPLES = MAX_DURATION * SAMPLE_RATE; // 14400 samples max

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

    // Resume AudioContext khi tab active lại (browser suspend AudioContext khi tab ẩn)
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        audioContext.state === "suspended"
      ) {
        audioContext.resume();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const maxWidth = MAX_SAMPLES;

    let amplificationFactor = 5;
    if (audioSourceType === "system") amplificationFactor = 10;
    else if (audioSourceType === "microphone") amplificationFactor = 3;

    // === SAMPLING LOOP: 1 sample/giây — khớp với browser throttle khi tab ẩn ===
    const sampleInterval = setInterval(() => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += Math.abs(normalized);
      }
      const amplitude = (sum / bufferLength) * amplificationFactor;

      if (waveformDataRef.current.length === 0) {
        recordingRealStartRef.current = performance.now();
      }
      const sampleTimeMs = performance.now() - recordingRealStartRef.current;

      waveformDataRef.current.push(amplitude);
      waveformTimesRef.current.push(sampleTimeMs);
      if (waveformDataRef.current.length > maxWidth) {
        waveformDataRef.current.shift();
        waveformTimesRef.current.shift();
        droppedSamplesRef.current += 1;
      }
    }, 1000);

    // === RENDER LOOP: rAF — chỉ vẽ khi tab active ===
    const render = () => {
      animationIdRef.current = requestAnimationFrame(render);

      canvasContext.fillStyle = "rgb(255, 255, 255)";
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);

      const totalDurationMs =
        waveformTimesRef.current.length > 0
          ? waveformTimesRef.current[waveformTimesRef.current.length - 1]
          : 0;

      // visibleDurationMs theo zoom: zoom=1 → 10 phút, zoom=2 → 5 phút, v.v.
      const BASE_VISIBLE_MS = 10 * 60 * 1000; // 10 phút
      const currentZoom = zoomRef.current;
      const currentScroll = scrollPositionRef.current;
      const visibleDurationMs = BASE_VISIBLE_MS / currentZoom;

      // scrollPosition [0,1] → startTimeMs trong khoảng [0, totalDurationMs - visibleDurationMs]
      const scrollableDurationMs = Math.max(
        0,
        totalDurationMs - visibleDurationMs,
      );

      let startTimeMs: number;
      if (currentScroll > 0.95 || totalDurationMs <= visibleDurationMs) {
        // Ghim latest sample vào mép phải (startTimeMs có thể âm khi data ít)
        startTimeMs = totalDurationMs - visibleDurationMs;
        if (scrollPositionRef.current !== 1) {
          scrollPositionRef.current = 1;
          setScrollPosition(1);
        }
      } else {
        startTimeMs = scrollableDurationMs * currentScroll;
      }
      const endTimeMs = startTimeMs + visibleDurationMs;

      // Tìm startIndex/endIndex theo timestamp
      const times = waveformTimesRef.current;
      let startIndex = 0;
      let endIndex = times.length;
      for (let i = 0; i < times.length; i++) {
        if (times[i] < startTimeMs) startIndex = i;
        if (times[i] <= endTimeMs) endIndex = i + 1;
      }

      const timeToX = (ms: number) =>
        ((ms - startTimeMs) / visibleDurationMs) * canvas.width;

      // Draw waveform bars
      canvasContext.fillStyle = "#e71212";
      for (let i = startIndex; i < endIndex; i++) {
        const amplitude = waveformDataRef.current[i];
        const barHeight = amplitude * canvas.height * 0.9;
        const tMs = times[i];
        const nextMs = times[i + 1] ?? tMs + 1000;
        const x = timeToX(tMs);
        const barW = Math.max(timeToX(nextMs) - x, 1);
        const y = (canvas.height - barHeight) / 2;
        canvasContext.fillRect(x, y, barW, barHeight);
      }

      // Center line
      canvasContext.strokeStyle = "rgba(0, 0, 0, 0.1)";
      canvasContext.lineWidth = 1;
      canvasContext.beginPath();
      canvasContext.moveTo(0, canvas.height / 2);
      canvasContext.lineTo(canvas.width, canvas.height / 2);
      canvasContext.stroke();

      // Time markers
      const totalSeconds = totalDurationMs / 1000;
      const markerInterval = 300; // 5 phút/label

      canvasContext.font = "10px monospace";

      // 0:00 label
      const x0 = timeToX(0);
      if (x0 >= 0 && x0 <= canvas.width) {
        canvasContext.fillStyle = "black";
        canvasContext.fillText("0:00", x0 + 2, 12);
        canvasContext.strokeStyle = "rgba(0, 0, 0, 0.12)";
        canvasContext.beginPath();
        canvasContext.moveTo(x0, 0);
        canvasContext.lineTo(x0, canvas.height);
        canvasContext.stroke();
      }

      for (
        let sec = markerInterval;
        sec <= totalSeconds;
        sec += markerInterval
      ) {
        const xM = timeToX(sec * 1000);
        if (xM < 0 || xM > canvas.width) continue;
        canvasContext.fillStyle = "black";
        canvasContext.fillText(formatTime(sec), xM + 2, 12);
        canvasContext.strokeStyle = "rgba(0, 0, 0, 0.12)";
        canvasContext.beginPath();
        canvasContext.moveTo(xM, 0);
        canvasContext.lineTo(xM, canvas.height);
        canvasContext.stroke();
      }
    };

    render();

    // Cleanup
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(sampleInterval);
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [audioStream, isRecording]);

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
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
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
