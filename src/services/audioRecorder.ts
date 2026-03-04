import type { AudioSourceType } from '../types/types';

export class AudioRecorderService {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private systemStream: MediaStream | null = null;
  private startTime: number = 0;
  private audioChunks: Blob[] = [];
  private currentChunkSize = 0;
  private isPausedState: boolean = false; // Track pause state for UI
  private audioSourceType: AudioSourceType = 'microphone' as AudioSourceType; // Default to microphone
  private onStreamEndedCallback: (() => void) | null = null; // Callback when stream ends
  private lastBackupChunkIndex: number = 0; // Tracks which chunks have already been saved for crash-backup

  /**
   * Start recording with specified audio source
   * @param sourceType - Type of audio source (microphone, system, or both)
   */
  async startRecording(sourceType: AudioSourceType = 'microphone' as AudioSourceType): Promise<void> {
    this.audioSourceType = sourceType;
    try {
      // Get audio streams based on selected source type
      const streams: MediaStream[] = [];

      // Get microphone stream if needed
      if (sourceType === 'microphone' as AudioSourceType || sourceType === 'both' as AudioSourceType) {
        try {
          this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              sampleRate: 48000,
              channelCount: 1 // Mono
            }
          });
          streams.push(this.micStream);
        } catch (error: any) {
          // If microphone fails when using 'both' mode, just warn and continue with system audio
          if (sourceType === 'both' as AudioSourceType) {
            console.warn('⚠️ Microphone not available, will record system audio only:', error.message);
            // Don't throw error, continue to get system audio
          } else {
            // For microphone-only mode, throw error
            if (error.name === 'NotAllowedError') {
              throw new Error('Microphone permission denied. Please allow access in browser settings.');
            } else if (error.name === 'NotFoundError') {
              throw new Error('No microphone found. Please connect a microphone and try again.');
            } else {
              throw new Error(`Microphone access failed: ${error.message}`);
            }
          }
        }
      }

      // Get system audio stream if needed
      if (sourceType === 'system' as AudioSourceType || sourceType === 'both' as AudioSourceType) {
        try {
          // @ts-ignore - getDisplayMedia is supported in modern browsers
          this.systemStream = await navigator.mediaDevices.getDisplayMedia({
            video: true, // Required by some browsers, will be removed later
            audio: {
              echoCancellation: false, // Don't cancel echo for system audio
              noiseSuppression: false, // Don't suppress noise for system audio
              sampleRate: 48000
            }
          });
          
          // Remove video tracks (we only need audio)
          this.systemStream.getVideoTracks().forEach(track => track.stop());
          
          // Check if audio track exists
          const audioTracks = this.systemStream.getAudioTracks();
          if (audioTracks.length === 0) {
            throw new Error('❌ Không phát hiện audio! Bạn quên chọn "Also share system audio" khi chọn tab/màn hình. Vui lòng thử lại!');
          }
          
          streams.push(this.systemStream);
        } catch (error: any) {
          // Clean up microphone stream if system audio fails
          if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
            this.micStream = null;
          }
          
          if (error.name === 'NotAllowedError') {
            throw new Error('❌ Bạn đã từ chối chia sẻ màn hình. Vui lòng cho phép và nhớ chọn "Also share system audio".');
          } else if (error.message.includes('audio')) {
            throw new Error(error.message); // Already has detailed message
          } else {
            throw new Error(`Không thể ghi âm từ system: ${error.message}`);
          }
        }
      }

      // Mix streams if we have multiple sources
      if (streams.length === 0) {
        throw new Error('No audio source selected');
      } else if (streams.length === 1) {
        this.stream = streams[0];
        // Update actual source type based on what we got
        if (sourceType === 'both' as AudioSourceType) {
          // User wanted both, but only got one - update to reflect reality
          if (this.micStream && !this.systemStream) {
            this.audioSourceType = 'microphone' as AudioSourceType;
          } else if (this.systemStream && !this.micStream) {
            this.audioSourceType = 'system' as AudioSourceType;
          }
        }
      } else {
        // Mix microphone + system audio
        const audioContext = new AudioContext();
        const mixedOutput = audioContext.createMediaStreamDestination();
        
        streams.forEach(stream => {
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(mixedOutput);
        });
        
        this.stream = mixedOutput.stream;
      }

      // Add event listener for when system audio sharing stops
      if (this.systemStream) {
        this.systemStream.getTracks().forEach(track => {
          track.onended = () => {
            console.warn('⚠️ System audio sharing stopped by user');
            if (this.onStreamEndedCallback) {
              this.onStreamEndedCallback();
            }
          };
        });
      }

      // Try to use WebM with Opus codec (much better compression than WAV)
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/wav'
      ];
      
      let selectedMimeType = '';
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          // console.log(`Using audio format: ${mimeType}`);
          break;
        }
      }

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: selectedMimeType || undefined,
        audioBitsPerSecond: 128000 // 128kbps - good quality, small size
      });

      this.audioChunks = [];
      this.currentChunkSize = 0;
      this.isPausedState = false; // Reset pause state

      // Collect audio data in chunks to prevent memory overflow
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          this.currentChunkSize += event.data.size;
          
          // Log progress for long recordings
          // if (this.audioChunks.length % 10 === 0) {
          //   const sizeMB = (this.currentChunkSize / (1024 * 1024)).toFixed(2);
          //   console.log(`Recording progress: ${this.audioChunks.length} chunks, ${sizeMB} MB`);
          // }
        }
      };

      this.mediaRecorder.onerror = (event: Event) => {
        console.error('MediaRecorder error:', event);
      };

      // Request data every 5 seconds to prevent single huge chunk
      this.mediaRecorder.start(5000);
      this.startTime = Date.now();
      
      // console.log('Recording started with MediaRecorder');
    } catch (error: any) {
      // Clean up any streams that were created
      if (this.micStream) {
        this.micStream.getTracks().forEach(track => track.stop());
        this.micStream = null;
      }
      if (this.systemStream) {
        this.systemStream.getTracks().forEach(track => track.stop());
        this.systemStream = null;
      }
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
      
      // Re-throw the error if it's already a custom error message
      if (error.message) {
        throw error;
      }
      
      // Generic fallback
      throw new Error(`Recording failed: ${error}`);
    }
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  getAudioSourceType(): AudioSourceType {
    return this.audioSourceType;
  }

  /**
   * Get file extension from current MediaRecorder MIME type
   * @returns File extension (e.g., 'webm', 'mp3', 'wav', 'ogg', 'mp4')
   */
  getAudioFileExtension(): string {
    if (!this.mediaRecorder) {
      return 'webm'; // Default fallback
    }

    const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
    
    // Map MIME types to extensions
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mp4')) return 'mp4';
    
    return 'webm'; // Default fallback
  }

  /**
   * Set callback for when stream ends (e.g., user stops screen sharing)
   */
  setOnStreamEndedCallback(callback: () => void): void {
    this.onStreamEndedCallback = callback;
  }

  async stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('No active recording'));
        return;
      }

      const recorder = this.mediaRecorder;
      
      recorder.onstop = () => {
        // console.log(`Recording stopped. Total chunks: ${this.audioChunks.length}, Total size: ${(this.currentChunkSize / (1024 * 1024)).toFixed(2)} MB`);
        
        // Combine all chunks into single blob
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(this.audioChunks, { type: mimeType });
        
        // Stop all tracks
        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop());
        }
        if (this.micStream) {
          this.micStream.getTracks().forEach(track => track.stop());
        }
        if (this.systemStream) {
          this.systemStream.getTracks().forEach(track => track.stop());
        }

        this.mediaRecorder = null;
        this.stream = null;
        this.micStream = null;
        this.systemStream = null;
        this.audioChunks = [];
        this.currentChunkSize = 0;
        this.isPausedState = false; // Reset pause state
        this.lastBackupChunkIndex = 0; // Reset delta pointer
        
        resolve(blob);
      };

      recorder.stop();
    });
  }

  getCurrentDuration(): number {
    if (!this.mediaRecorder) return 0;
    
    // Return total elapsed time (including pauses)
    // This matches the actual audio file duration which includes silence during pauses
    return Date.now() - this.startTime;
  }

  /**
   * Return only the audio chunks recorded since the last call to this method
   * (delta / incremental approach). Does NOT copy the full accumulated buffer,
   * so cost is O(newChunks) not O(totalRecordingSize) – safe for long sessions.
   * Returns null when recording hasn't started yet or no new data is available.
   */
  getDeltaChunks(): { chunks: Blob[]; mimeType: string } | null {
    if (!this.mediaRecorder || this.audioChunks.length === 0) return null;
    const newChunks = this.audioChunks.slice(this.lastBackupChunkIndex);
    if (newChunks.length === 0) return null;
    this.lastBackupChunkIndex = this.audioChunks.length;
    return { chunks: newChunks, mimeType: this.mediaRecorder.mimeType || 'audio/webm' };
  }

  isRecording(): boolean {
    return this.mediaRecorder !== null && 
           this.mediaRecorder.state === 'recording' && 
           !this.isPausedState; // Not paused
  }

  isPaused(): boolean {
    return this.isPausedState;
  }

  /**
   * Pause recording by muting the microphone
   * MediaRecorder continues running and records silence
   * This ensures audio file duration matches total elapsed time
   */
  pauseRecording(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
      throw new Error('No active recording to pause');
    }

    if (!this.stream) {
      throw new Error('No audio stream available');
    }

    // Mute all audio tracks from original streams
    // This ensures both mic and system audio are muted
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
    }
    
    if (this.systemStream) {
      this.systemStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
    }
    
    // Also mute the main stream (for single-source mode)
    this.stream.getAudioTracks().forEach(track => {
      track.enabled = false;
    });

    this.isPausedState = true;
  }

  /**
   * Resume recording by unmuting the microphone
   */
  resumeRecording(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
      throw new Error('Recording is not active');
    }

    if (!this.stream) {
      throw new Error('No audio stream available');
    }

    if (!this.isPausedState) {
      throw new Error('Recording is not paused');
    }

    // Unmute all audio tracks from original streams
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach(track => {
        track.enabled = true;
      });
    }
    
    if (this.systemStream) {
      this.systemStream.getAudioTracks().forEach(track => {
        track.enabled = true;
      });
    }
    
    // Also unmute the main stream (for single-source mode)
    this.stream.getAudioTracks().forEach(track => {
      track.enabled = true;
    });

    this.isPausedState = false;
  }

  // Format duration to HH:MM:SS
  static formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}
