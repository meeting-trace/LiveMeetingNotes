import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Button, Space, Slider, Select, Spin, Alert } from "antd";
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  SoundOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import WaveSurfer from "wavesurfer.js";

interface Props {
  audioBlob: Blob | null;
  transcriptionConfig?: any;
  onWaveformReady?: () => void; // fired when WaveSurfer finishes decoding + drawing
  onWaveformError?: (error: string) => void; // fired on decode/OOM errors
  waveColor?: string;     // color of unplayed waveform (right of cursor)
  progressColor?: string; // color of played waveform (left of cursor)
}

export interface AudioPlayerRef {
  seekTo: (timeMs: number) => void;
  play: () => Promise<void>;
  getDuration: () => number;
}

/** Files larger than this threshold skip AudioContext.decodeAudioData() to avoid OOM.
 *  WebAudio decode of a 5-hour 48kHz stereo recording requires ~7 GB RAM.
 *  Instead, WaveSurfer receives pre-computed flat peaks + HTML5 Audio duration.
 */
const LARGE_FILE_THRESHOLD_BYTES = 80 * 1024 * 1024; // 80 MB

/** Resolve the duration of an <audio> element, handling WebM Infinity quirk.
 *  WebM files recorded by MediaRecorder often omit the Duration header →
 *  audio.duration === Infinity. The workaround: seek to a huge timestamp so
 *  the browser scans to the end and updates duration.
 */
function resolveAudioDuration(el: HTMLAudioElement): Promise<number> {
  return new Promise((resolve) => {
    const bail = setTimeout(() => resolve(0), 8000);

    const finish = (dur: number) => {
      clearTimeout(bail);
      resolve(isFinite(dur) && dur > 0 ? dur : 0);
    };

    const onTimeUpdate = () => {
      if (isFinite(el.duration) && el.duration > 0) {
        el.removeEventListener("timeupdate", onTimeUpdate);
        finish(el.duration);
      }
    };

    const onMeta = () => {
      if (isFinite(el.duration) && el.duration > 0) {
        finish(el.duration);
      } else {
        // Infinity duration (streaming WebM) — seek trick
        el.addEventListener("timeupdate", onTimeUpdate);
        el.currentTime = 1e9;
      }
    };

    if (el.readyState >= 1 /* HAVE_METADATA */) {
      onMeta();
    } else {
      el.addEventListener("loadedmetadata", onMeta, { once: true });
      el.addEventListener("error", () => finish(0), { once: true });
    }
  });
}

/**
 * Generate visually realistic waveform peaks for large files where full
 * AudioContext decode is skipped to avoid OOM.
 *
 * Simulates a typical meeting recording:
 *   • Speech/silence zones (cosine-interpolated transitions)
 *   • Within-speech amplitude variation (phoneme-level flutter)
 *   • Seeded from blob size so the same file always renders identically
 */
function generateRealisticPeaks(numPeaks: number, seed: number): number[] {
  // Seeded 32-bit LCG PRNG — fast and deterministic
  let s = seed >>> 0 || 123456789;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };

  // ── Step 1: Speech/silence envelope ──────────────────────────────
  // 48 zones across the recording; ~65% speech, ~35% silence
  const NUM_ZONES = 48;
  const zoneAmplitude = Array.from(
    { length: NUM_ZONES },
    () =>
      rand() > 0.35
        ? rand() * 0.55 + 0.35 // speech  : 0.35–0.90
        : rand() * 0.08 + 0.02, // silence : 0.02–0.10
  );

  // ── Step 2: Per-peak value via cosine-interpolated envelope ──────
  const raw = new Array<number>(numPeaks);
  for (let i = 0; i < numPeaks; i++) {
    const t = (i / numPeaks) * (NUM_ZONES - 1);
    const z0 = Math.floor(t);
    const z1 = Math.min(z0 + 1, NUM_ZONES - 1);
    const frac = t - z0;
    // Cosine interpolation → smooth speech↔silence transitions
    const interp =
      zoneAmplitude[z0] +
      (zoneAmplitude[z1] - zoneAmplitude[z0]) *
        (1 - Math.cos(frac * Math.PI)) *
        0.5;
    // High-frequency flutter (phoneme / word boundaries)
    const flutter = rand() * 0.35 + 0.65; // 0.65–1.00 multiplier
    raw[i] = Math.max(0.02, Math.min(0.95, interp * flutter));
  }

  // ── Step 3: Light smoothing pass (window = ±4) ───────────────────
  const W = 4;
  const smoothed = new Array<number>(numPeaks);
  for (let i = 0; i < numPeaks; i++) {
    let sum = 0,
      cnt = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(numPeaks - 1, i + W); j++) {
      sum += raw[j];
      cnt++;
    }
    smoothed[i] = sum / cnt;
  }

  return smoothed;
}

export const AudioPlayer = forwardRef<AudioPlayerRef, Props>(
  (
    { audioBlob, transcriptionConfig, onWaveformReady, onWaveformError,
      waveColor = "#87c3fc",     // Ant Design blue-3 — light/unplayed
      progressColor = "#1677ff", // Ant Design blue-6 — vivid/played
    },
    ref,
  ) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const waveformRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const fitZoomRef = useRef<number>(0); // px/sec that makes waveform fit the container exactly
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [volume, setVolume] = useState(100);
    const [zoom, setZoom] = useState(50);
    const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [loadingPhase, setLoadingPhase] = useState<"reading" | "decoding">(
      "reading",
    );
    const [isLargeFileMode, setIsLargeFileMode] = useState(false);

    // Expose seekTo method to parent
    useImperativeHandle(ref, () => ({
      seekTo: (timeMs: number) => {
        if (wavesurferRef.current && duration > 0) {
          const timeSeconds = timeMs / 1000;
          wavesurferRef.current.seekTo(timeSeconds / duration);
          // console.log(`🎵 Seeked to ${timeSeconds.toFixed(2)}s`);
        }
      },
      play: async () => {
        if (wavesurferRef.current) {
          await wavesurferRef.current.play();
          setIsPlaying(true);
        }
      },
      getDuration: () => duration * 1000,
    }));

    // Update audio source when blob changes
    useEffect(() => {
      if (audioBlob) {
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);

        // Only revoke URL on cleanup (when component unmounts or new blob arrives)
        return () => {
          URL.revokeObjectURL(url);
        };
      } else {
        // No blob, clear URL
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
          setAudioUrl(null);
        }
      }
    }, [audioBlob]);

    // Initialize WaveSurfer
    useEffect(() => {
      if (!waveformRef.current || !audioBlob) return;

      // Destroy existing instance
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
      }

      try {
        const isLargeFile = audioBlob.size > LARGE_FILE_THRESHOLD_BYTES;
        setIsLargeFileMode(isLargeFile);

        // For large files, create an HTML Audio element as the WaveSurfer media backend.
        // This avoids AudioContext.decodeAudioData() which would require gigabytes of RAM
        // for long recordings (e.g. 5-hour recording → ~7 GB decoded PCM).
        let largeBlobUrl: string | null = null;
        let largeAudioEl: HTMLAudioElement | null = null;
        let largeDurationResolved = false; // guard for async resolveAudioDuration
        if (isLargeFile) {
          largeBlobUrl = URL.createObjectURL(audioBlob);
          largeAudioEl = new Audio();
          largeAudioEl.src = largeBlobUrl;
          largeAudioEl.preload = "metadata";
        }

        // Create WaveSurfer instance
        const wavesurfer = WaveSurfer.create({
          container: waveformRef.current,
          waveColor,
          progressColor,
          cursorColor: "#ff4d4f",
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          height: 100,
          normalize: true,
          interact: true, // Enable click to seek
          dragToSeek: false, // Click only, no drag to seek
          hideScrollbar: false,
          ...(isLargeFile && largeAudioEl ? { media: largeAudioEl } : {}),
        });

        // Show loading indicator before starting to load
        setIsLoadingWaveform(true);
        setLoadingProgress(0);
        setLoadingPhase("reading");

        if (isLargeFile && largeBlobUrl && largeAudioEl) {
          // ── Large-file path: skip decodeAudioData, use flat placeholder peaks ──
          // WaveSurfer v7: when load(url, channelData, duration) is called with
          // channelData provided, it skips the fetch+decode step entirely and
          // renders the supplied peaks directly.
          const capturedUrl = largeBlobUrl;
          const capturedEl = largeAudioEl;
          resolveAudioDuration(capturedEl).then((audioDuration) => {
            if (largeDurationResolved) return; // blob changed / component unmounted
            const numPeaks = 3000;
            const realisticPeaks = generateRealisticPeaks(
              numPeaks,
              audioBlob.size,
            );
            wavesurfer.load(
              capturedUrl,
              [realisticPeaks],
              audioDuration > 0 ? audioDuration : undefined,
            );
          });
        } else {
          // ── Normal path: loadBlob → decodeAudioData → real peaks ──
          wavesurfer.loadBlob(audioBlob);
        }

        // Event listeners
        wavesurfer.on("loading", (percent: number) => {
          const pct = Math.round(percent);
          setLoadingProgress(pct);
          if (pct >= 100) {
            setLoadingPhase("decoding");
          } else {
            setLoadingPhase("reading");
          }
        });

        wavesurfer.on("ready", () => {
          setIsLoadingWaveform(false);
          setLoadingProgress(100);
          const dur = wavesurfer.getDuration();
          setDuration(dur);
          // Calculate the natural "fit to container" zoom level so handleWheel
          // can use it as the lower bound and prevent over-zooming-out.
          const containerW = waveformRef.current?.offsetWidth ?? 0;
          if (dur > 0 && containerW > 0) {
            fitZoomRef.current = containerW / dur;
            // Sync zoom state to match the actual auto-fit zoom WaveSurfer is
            // displaying. Without this, state=50 while reality=fitZoom, causing
            // scroll-out to traverse a huge range before reaching full view.
            setZoom(fitZoomRef.current);
          }
          console.log(
            "✅ WaveSurfer ready, duration:",
            dur,
            "fitZoom:",
            fitZoomRef.current.toFixed(4),
          );
          onWaveformReady?.();
        });

        // Add error handler
        wavesurfer.on("error", (error) => {
          setIsLoadingWaveform(false);
          console.error("❌ WaveSurfer error:", error);
          setDuration(0);
          const msg = (error as any)?.message || String(error);
          // Detect Out-of-Memory: browser throws DOMException or generic Error
          const isOOM =
            msg.toLowerCase().includes("memory") ||
            msg.toLowerCase().includes("out of memory") ||
            msg.toLowerCase().includes("unable to decode");
          onWaveformError?.(
            isOOM
              ? "OOM: File ghi âm quá lớn, vượt quá bộ nhớ RAM của tab. Vui lòng tải lại trang và chọn 'Chỉ khôi phục ghi chú'."
              : `Không thể tải waveform: ${msg}`,
          );
        });

        wavesurfer.on("timeupdate", (time) => {
          setCurrentTime(time);
        });

        wavesurfer.on("play", () => {
          setIsPlaying(true);
        });

        wavesurfer.on("pause", () => {
          setIsPlaying(false);
        });

        wavesurfer.on("finish", () => {
          setIsPlaying(false);
        });

        // Add interaction event for better UX
        wavesurfer.on("interaction", () => {
          // User clicked on waveform
          if (!isPlaying) {
            // Optional: auto-play when clicking on waveform
            // wavesurfer.play();
          }
        });

        wavesurfer.on("seeking", (currentTime) => {
          // Update current time while seeking/dragging
          setCurrentTime(currentTime);
        });

        wavesurferRef.current = wavesurfer;

        // Get waveform container for event handlers
        const waveformContainer = waveformRef.current;

        // Add double-click handler for seek and play
        const handleDoubleClick = (e: MouseEvent) => {
          const rect = waveformContainer.getBoundingClientRect();
          const clickX = e.clientX - rect.left + waveformContainer.scrollLeft;
          const waveformWidth = waveformContainer.scrollWidth;
          const clickRatio = clickX / waveformWidth;
          const totalDuration = wavesurfer.getDuration();
          const seekTime = clickRatio * totalDuration;

          if (!isNaN(seekTime) && seekTime >= 0 && totalDuration > 0) {
            wavesurfer.setTime(seekTime);
            // Auto-play from this position
            if (!wavesurfer.isPlaying()) {
              wavesurfer.play();
            }
          }
        };

        waveformContainer.addEventListener("dblclick", handleDoubleClick);

        // Add context menu with options
        const handleContextMenu = (e: MouseEvent) => {
          e.preventDefault();
          const time = wavesurfer.getCurrentTime();

          // Remove existing menu if any
          const existingMenu = document.getElementById("audio-context-menu");
          if (existingMenu) {
            existingMenu.remove();
          }

          // Create context menu
          const menu = document.createElement("div");
          menu.id = "audio-context-menu";
          menu.style.cssText = `
        position: fixed;
        left: ${e.clientX}px;
        top: ${e.clientY}px;
        background: white;
        border: 1px solid #d9d9d9;
        border-radius: 6px;
        box-shadow: 0 3px 6px -4px rgba(0,0,0,.12), 0 6px 16px 0 rgba(0,0,0,.08), 0 9px 28px 8px rgba(0,0,0,.05);
        z-index: 10000;
        padding: 4px 0;
        min-width: 200px;
      `;

          // Menu items
          const menuItems = [
            {
              label: `📝 Chèn ghi chú tại vị trí ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`,
              action: () => {
                window.dispatchEvent(
                  new CustomEvent("insert-note-at-time", {
                    detail: { time },
                  }),
                );
                // Show visual feedback
                const notification = document.createElement("div");
                notification.textContent = `📝 Inserting note at ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
                notification.style.cssText = `
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              background: #1890ff;
              color: white;
              padding: 12px 24px;
              border-radius: 6px;
              font-size: 14px;
              font-weight: 500;
              z-index: 10001;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
              animation: fadeInOut 1.5s ease-in-out;
            `;
                document.body.appendChild(notification);
                setTimeout(() => notification.remove(), 1500);
              },
            },
            {
              label: "✨ Chuyển đổi giọng nói sang văn bản bằng Gemini AI",
              action: () => {
                // Get current config from settings
                const config = (window as any).speechToTextConfig;
                if (config && config.geminiApiKey && config.geminiModel) {
                  window.dispatchEvent(
                    new CustomEvent("transcribe-audio", {
                      detail: {
                        apiKey: config.geminiApiKey,
                        modelName: config.geminiModel,
                      },
                    }),
                  );
                } else {
                  // If no config, dispatch without detail to show settings modal
                  window.dispatchEvent(new CustomEvent("transcribe-audio"));
                }
              },
            },
          ];

          // Only show 'Transcribe audio with Gemini AI' if Gemini API Key is present
          if (!transcriptionConfig?.geminiApiKey) {
            menuItems.pop(); // Remove the last item (Transcribe audio with Gemini AI)
          }

          menuItems.forEach((item) => {
            const menuItem = document.createElement("div");
            menuItem.textContent = item.label;
            menuItem.style.cssText = `
          padding: 8px 16px;
          cursor: pointer;
          font-size: 14px;
          color: rgba(0, 0, 0, 0.88);
          transition: background-color 0.2s;
        `;

            menuItem.addEventListener("mouseenter", () => {
              menuItem.style.backgroundColor = "#f5f5f5";
            });

            menuItem.addEventListener("mouseleave", () => {
              menuItem.style.backgroundColor = "transparent";
            });

            menuItem.addEventListener("click", () => {
              item.action();
              menu.remove();
            });

            menu.appendChild(menuItem);
          });

          // Close menu when clicking outside
          const closeMenu = (evt: MouseEvent) => {
            if (!menu.contains(evt.target as Node)) {
              menu.remove();
              document.removeEventListener("click", closeMenu);
            }
          };

          setTimeout(() => {
            document.addEventListener("click", closeMenu);
          }, 0);

          document.body.appendChild(menu);
        };

        waveformContainer.addEventListener("contextmenu", handleContextMenu);

        // Add keyboard handler for play/pause with spacebar
        let isMouseInWaveform = false;

        const handleMouseEnter = () => {
          isMouseInWaveform = true;
        };

        const handleMouseLeave = () => {
          isMouseInWaveform = false;
        };

        const handleKeyDown = (e: KeyboardEvent) => {
          // Only handle spacebar when mouse is in waveform
          if (isMouseInWaveform && (e.code === "Space" || e.key === " ")) {
            e.preventDefault(); // Prevent page scroll

            if (wavesurfer.isPlaying()) {
              wavesurfer.pause();
            } else {
              wavesurfer.play();
            }
          }
        };

        waveformContainer.addEventListener("mouseenter", handleMouseEnter);
        waveformContainer.addEventListener("mouseleave", handleMouseLeave);
        window.addEventListener("keydown", handleKeyDown);

        // Add mouse wheel zoom functionality
        const handleWheel = (e: WheelEvent) => {
          // Stop event from bubbling and prevent default scroll
          e.preventDefault();
          e.stopPropagation();

          // Multiplicative zoom: each scroll step scales by 25%.
          // This feels natural at every zoom level (both tiny px/sec and large).
          const ZOOM_FACTOR = 1.25;
          // Lower bound = the px/sec that fills the container exactly (no scrollbar).
          // Falls back to 1 before the first "ready" event fires.
          const minZoom = fitZoomRef.current > 0 ? fitZoomRef.current : 1;

          setZoom((prevZoom) => {
            if (e.deltaY < 0) {
              // Scroll up → zoom in
              return Math.min(prevZoom * ZOOM_FACTOR, 1000);
            } else {
              // Scroll down → zoom out, but never below natural fit
              return Math.max(prevZoom / ZOOM_FACTOR, minZoom);
            }
          });
        };

        // Add wheel event listener with passive: false to allow preventDefault
        waveformContainer.addEventListener("wheel", handleWheel, {
          passive: false,
        });

        wavesurferRef.current = wavesurfer;

        // Cleanup function
        return () => {
          setIsLoadingWaveform(false);
          setIsLargeFileMode(false);
          largeDurationResolved = true; // prevent pending resolveAudioDuration from calling load()
          fitZoomRef.current = 0; // reset so next file starts fresh
          if (largeBlobUrl) {
            URL.revokeObjectURL(largeBlobUrl);
          }
          try {
            waveformContainer.removeEventListener("wheel", handleWheel);
            waveformContainer.removeEventListener(
              "dblclick",
              handleDoubleClick,
            );
            waveformContainer.removeEventListener(
              "contextmenu",
              handleContextMenu,
            );
            waveformContainer.removeEventListener(
              "mouseenter",
              handleMouseEnter,
            );
            waveformContainer.removeEventListener(
              "mouseleave",
              handleMouseLeave,
            );
            window.removeEventListener("keydown", handleKeyDown);
            wavesurfer.destroy();
          } catch (cleanupError) {
            console.error("Error during cleanup:", cleanupError);
          }
        };
      } catch (error) {
        console.error("❌ Failed to initialize WaveSurfer:", error);
        setDuration(0);
        setIsLoadingWaveform(false);
        const msg = (error as any)?.message || String(error);
        onWaveformError?.(`Không thể khởi tạo audio player: ${msg}`);
        return () => {};
      }
    }, [audioBlob]);

    // Setup audio element event listeners
    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;

      const updateTime = () => setCurrentTime(audio.currentTime);
      const updateDuration = () => setDuration(audio.duration);
      const handleEnded = () => setIsPlaying(false);

      audio.addEventListener("timeupdate", updateTime);
      audio.addEventListener("loadedmetadata", updateDuration);
      audio.addEventListener("ended", handleEnded);

      return () => {
        audio.removeEventListener("timeupdate", updateTime);
        audio.removeEventListener("loadedmetadata", updateDuration);
        audio.removeEventListener("ended", handleEnded);
      };
    }, [audioUrl]);

    // Update WaveSurfer playback rate
    useEffect(() => {
      if (wavesurferRef.current) {
        wavesurferRef.current.setPlaybackRate(playbackRate);
      }
    }, [playbackRate]);

    // Update WaveSurfer volume
    useEffect(() => {
      if (wavesurferRef.current) {
        const volumeLevel = Math.min(volume / 100, 1);
        wavesurferRef.current.setVolume(volumeLevel);
      }
    }, [volume]);

    // Update WaveSurfer zoom
    useEffect(() => {
      if (wavesurferRef.current) {
        wavesurferRef.current.zoom(zoom);
      }
    }, [zoom]);

    // Listen for seek events from NotesEditor
    useEffect(() => {
      const handleSeek = (e: Event) => {
        const customEvent = e as CustomEvent;
        const time = customEvent.detail.time;
        if (wavesurferRef.current) {
          wavesurferRef.current.setTime(time);
          if (!isPlaying) {
            handlePlay();
          }
        }
      };

      window.addEventListener("seek-audio", handleSeek);
      return () => window.removeEventListener("seek-audio", handleSeek);
    }, [isPlaying]);

    const handlePlay = async () => {
      if (!wavesurferRef.current) return;

      try {
        await wavesurferRef.current.play();
        setIsPlaying(true);
      } catch (error) {
        console.error("Failed to play audio:", error);
      }
    };

    const handlePause = () => {
      if (!wavesurferRef.current) return;
      wavesurferRef.current.pause();
      setIsPlaying(false);
    };

    const handleSeek = (value: number) => {
      if (!wavesurferRef.current) return;
      wavesurferRef.current.setTime(value);
      setCurrentTime(value);
    };

    const handleSkipBackward = () => {
      if (!wavesurferRef.current) return;
      const newTime = Math.max(0, currentTime - 10);
      wavesurferRef.current.setTime(newTime);
    };

    const handleSkipForward = () => {
      if (!wavesurferRef.current) return;
      const newTime = Math.min(duration, currentTime + 10);
      wavesurferRef.current.setTime(newTime);
    };

    const handlePlaybackRateChange = (rate: number) => {
      if (!wavesurferRef.current) return;
      wavesurferRef.current.setPlaybackRate(rate);
      setPlaybackRate(rate);
    };

    const handleVolumeChange = (value: number) => {
      if (!wavesurferRef.current) return;
      // Volume range is 0-1 for wavesurfer, but we use 0-200 for UI (allowing 2x amplification)
      const volumeLevel = Math.min(value / 100, 1);
      wavesurferRef.current.setVolume(volumeLevel);
      setVolume(value);
    };

    const handleZoomIn = () => {
      setZoom((prev) => Math.min(prev * 1.25, 1000));
    };

    const handleZoomOut = () => {
      const minZoom = fitZoomRef.current > 0 ? fitZoomRef.current : 1;
      setZoom((prev) => Math.max(prev / 1.25, minZoom));
    };

    const formatTime = (seconds: number): string => {
      if (isNaN(seconds)) return "00:00:00";

      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);

      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    if (!audioBlob) {
      return (
        <div className="audio-player disabled">
          <div className="player-info">
            📢 Không có tệp âm thanh. Hãy ghi âm một cuộc họp để sử dụng các
            điều khiển phát lại.
          </div>
        </div>
      );
    }

    return (
      <div className="audio-player">
        {/* Large-file mode banner */}
        {isLargeFileMode && !isLoadingWaveform && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 8, fontSize: 12 }}
            message={
              <span>
                <strong>Chế độ file lớn:</strong> Waveform hiển thị dạng đơn
                giản (bỏ qua giải mã PCM) để tránh lỗi bộ nhớ. Phát lại và tua
                hoạt động bình thường.
              </span>
            }
          />
        )}

        {/* Waveform Container */}
        <div className="waveform-container" style={{ position: "relative" }}>
          <div
            ref={waveformRef}
            className="waveform"
            style={{
              opacity: isLoadingWaveform ? 0.25 : 1,
              transition: "opacity 0.3s ease",
            }}
          />
          {isLoadingWaveform && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                background: "rgba(0, 0, 0, 0.55)",
                borderRadius: 4,
                zIndex: 10,
              }}
            >
              <Spin
                indicator={
                  <LoadingOutlined
                    style={{ fontSize: 28, color: "#4a9eff" }}
                    spin
                  />
                }
              />
              <div style={{ color: "#e0e0e0", fontSize: 13, fontWeight: 500 }}>
                {loadingPhase === "reading"
                  ? loadingProgress > 0
                    ? `Đang xử lý file âm thanh ... ${loadingProgress}%`
                    : "Đang xử lý file âm thanh ..."
                  : "Đang giải mã waveform..."}
              </div>
              {loadingPhase === "reading" &&
                loadingProgress > 0 &&
                loadingProgress < 100 && (
                  <div
                    style={{
                      width: "55%",
                      height: 4,
                      background: "#333",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${loadingProgress}%`,
                        background: "#4a9eff",
                        borderRadius: 2,
                        transition: "width 0.2s ease",
                      }}
                    />
                  </div>
                )}
            </div>
          )}
        </div>

        <div className="player-controls">
          <Space size="middle">
            <Button
              icon={<StepBackwardOutlined />}
              onClick={handleSkipBackward}
              size="large"
              title="Skip backward 10 seconds"
              disabled={isLoadingWaveform}
            >
              -10s
            </Button>

            {!isPlaying ? (
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handlePlay}
                size="large"
                disabled={isLoadingWaveform}
              >
                Play
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<PauseCircleOutlined />}
                onClick={handlePause}
                size="large"
                disabled={isLoadingWaveform}
              >
                Pause
              </Button>
            )}

            <Button
              icon={<StepForwardOutlined />}
              onClick={handleSkipForward}
              size="large"
              title="Skip forward 10 seconds"
              disabled={isLoadingWaveform}
            >
              +10s
            </Button>
          </Space>

          <Space size="middle" style={{ marginLeft: "20px" }}>
            <Select
              value={playbackRate}
              onChange={handlePlaybackRateChange}
              style={{ width: 100 }}
              options={[
                { value: 0.5, label: "0.5x" },
                { value: 0.75, label: "0.75x" },
                { value: 1.0, label: "1.0x" },
                { value: 1.25, label: "1.25x" },
                { value: 1.5, label: "1.5x" },
                { value: 1.75, label: "1.75x" },
                { value: 2.0, label: "2.0x" },
              ]}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                minWidth: "200px",
              }}
            >
              <SoundOutlined />
              <Slider
                min={0}
                max={200}
                value={volume}
                onChange={handleVolumeChange}
                tooltip={{
                  formatter: (value: number | undefined) => `${value}%`,
                }}
                style={{ flex: 1, margin: 0 }}
              />
              <span style={{ minWidth: "45px", textAlign: "right" }}>
                {volume}%
              </span>
            </div>

            <Space size="small">
              <Button
                icon={<ZoomOutOutlined />}
                onClick={handleZoomOut}
                title="Zoom out"
                style={{ display: "none" }}
                disabled={zoom <= 10}
              />
              <Button
                icon={<ZoomInOutlined />}
                onClick={handleZoomIn}
                title="Zoom in"
                style={{ display: "none" }}
                disabled={zoom >= 200}
              />
            </Space>
          </Space>
        </div>

        <div className="player-progress">
          <span className="time-display">{formatTime(currentTime)}</span>
          <Slider
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            tooltip={{
              formatter: (value: number | undefined) => formatTime(value || 0),
            }}
            className="audio-slider"
          />
          <span className="time-display">{formatTime(duration)}</span>
        </div>
      </div>
    );
  },
);
