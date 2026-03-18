// TypeScript interfaces and types for the application

export interface MeetingInfo {
  title: string;
  date: string;
  time: string;
  location: string;
  host: string;
  attendees: string;
}

export interface TranscriptionSegment {
  Index: number;
  Start: string;
  End: string;
  Text: string;
  Highlight: boolean;
}

export interface TranscriptionProject {
  ProjectName: string;
  AudioPath: string;
  ModelName: string;
  Language: string;
  Duration: string;
  Segments: TranscriptionSegment[];
}

export interface MeetingMetadata {
  MeetingTitle: string;
  MeetingDate: string;
  MeetingTime: string;
  Location: string;
  Host: string;
  Attendees: string;
  CreatedAt: string;
}

export interface TimestampEntry {
  position: number;
  timeMs: number;
  text: string;
}

// NoteLine: Clean data structure for notes editor
// Each line is a self-contained object (no more separate Maps)
export interface NoteLine {
  content: string;        // Text content of the line
  timestamp?: number;     // Timestamp in milliseconds (optional)
  speaker?: string;       // Speaker name (optional)
}

export interface AudioRecorderState {
  isRecording: boolean;
  duration: number;
  error: string | null;
}

// Audio source types for recording
export enum AudioSourceType {
  MICROPHONE = 'microphone',        // Record from microphone only
  SYSTEM_AUDIO = 'system',          // Record system/tab audio only
  BOTH = 'both'                     // Mix microphone + system audio
}

export interface FileSystemSupport {
  hasFileSystemAccess: boolean;
  hasFallback: boolean;
}

// Gemini Model metadata from API
export interface GeminiModel {
  name: string; // e.g., "models/gemini-2.5-flash"
  displayName: string; // e.g., "Gemini Flash Latest"
  description?: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportedGenerationMethods: string[];
}

// Google Cloud Speech-to-Text types
export interface SpeechToTextConfig {
  apiKey: string;
  geminiApiKey?: string; // Optional: API key for Gemini AI (for AI refinement feature)
  geminiModel?: string; // Selected Gemini model (e.g., "models/gemini-2.5-flash")
  languageCode: string;
  enableSpeakerDiarization: boolean;
  enableAutomaticPunctuation: boolean;
  maxAlternatives?: number; // Number of alternative transcriptions (1-5)
  minSpeakerCount?: number; // Minimum speakers for diarization (2-6)
  maxSpeakerCount?: number; // Maximum speakers for diarization (2-6)
  segmentTimeout?: number; // Timeout for segment completion in ms (1000-5000, default 2500)
  segmentMaxLength?: number; // Max characters before forcing segment (100-300)
  timestampDelay?: number; // Timestamp delay offset in seconds for manual note-taking (0-60, default: 8)
  
  // Gemini API Limits Configuration
  maxAudioDurationMinutes?: number; // Maximum audio duration in minutes (default: 30)
  maxFileSizeMB?: number; // Maximum file size in MB (default: 20)
  requestDelaySeconds?: number; // Delay between API requests in seconds (default: 5)
  summaryPrompt?: string; // Custom prompt for Gemini summary generation

  // Language selector customisation
  availableLanguages?: string[]; // BCP-47 codes shown in the RecordingControls language switcher
}

export interface TranscriptionResult {
  id: string;
  text: string;
  startTime: string; // ISO format datetime
  endTime: string;   // ISO format datetime
  audioTimeMs?: number; // Relative time in audio (milliseconds from recording start)
  confidence: number;
  speaker: string;  // Speaker identification - default "Person1"
  isFinal: boolean;
  isManuallyEdited?: boolean; // True if user manually edited the text
  isAIRefined?: boolean; // True if text was refined by AI
}

export interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
  words?: Array<{
    word: string;
    startTime: string;
    endTime: string;
    speakerTag?: number;
  }>;
}

export interface SpeechRecognitionResult {
  alternatives: SpeechRecognitionAlternative[];
  isFinal: boolean;
  resultEndTime: string;
  languageCode: string;
}

// Extend Window interface for File System Access API
declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
    }) => Promise<FileSystemDirectoryHandle>;
  }
}
