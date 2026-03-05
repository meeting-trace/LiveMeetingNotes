import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Button, Space, Slider, Select, Spin } from "antd";
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
}

export interface AudioPlayerRef {
  seekTo: (timeMs: number) => void;
  play: () => Promise<void>;
  getDuration: () => number;
}

export const AudioPlayer = forwardRef<AudioPlayerRef, Props>(
  (
    { audioBlob, transcriptionConfig, onWaveformReady, onWaveformError },
    ref,
  ) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const waveformRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
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
        // Create WaveSurfer instance
        const wavesurfer = WaveSurfer.create({
          container: waveformRef.current,
          waveColor: "#4a9eff",
          progressColor: "#1890ff",
          cursorColor: "#ff4d4f",
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          height: 100,
          normalize: true,
          interact: true, // Enable click to seek
          dragToSeek: false, // Click only, no drag to seek
          hideScrollbar: false,
        });

        // Show loading indicator before starting to load
        setIsLoadingWaveform(true);
        setLoadingProgress(0);
        setLoadingPhase("reading");

        // Load audio with error handling - use loadBlob to avoid fetch() issues with File objects
        wavesurfer.loadBlob(audioBlob);

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
          setDuration(wavesurfer.getDuration());
          console.log(
            "✅ WaveSurfer ready, duration:",
            wavesurfer.getDuration(),
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

          // Determine zoom direction based on wheel delta
          const delta = e.deltaY;
          const zoomStep = 5;

          setZoom((prevZoom) => {
            let newZoom;
            if (delta < 0) {
              // Scroll up = Zoom in
              newZoom = Math.min(prevZoom + zoomStep, 200);
            } else {
              // Scroll down = Zoom out
              newZoom = Math.max(prevZoom - zoomStep, 10);
            }
            return newZoom;
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
      setZoom((prev) => Math.min(prev + 10, 200));
    };

    const handleZoomOut = () => {
      setZoom((prev) => Math.max(prev - 10, 10));
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
