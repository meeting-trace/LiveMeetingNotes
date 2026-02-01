// Auto-backup service using localStorage and IndexedDB
// Protects against browser crashes and accidental closures

const STORAGE_KEY = 'meetingNote_autoBackup';
const DB_NAME = 'MeetingNoteDB';
const DB_VERSION = 1;
const AUDIO_STORE = 'audioBlobs';

interface BackupData {
  timestamp: number;
  meetingInfo: {
    projectName: string;
    location: string;
    participants: string;
  };
  notes: string;
  timestampMap: [number, number][]; // Array of [position, datetime] for serialization
  speakersMap?: [number, string][]; // Array of [lineIndex, speaker] for serialization
  recordingStartTime: number;
  hasAudioBlob: boolean;
  isSaved: boolean;
  transcriptions?: any[]; // Speech-to-Text results
  rawTranscripts?: any[]; // Raw Speech-to-Text data for AI refinement
  geminiSummary?: string; // AI-generated meeting summary
}

// Open IndexedDB connection
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE);
      }
    };
  });
};

// Save audio blob to IndexedDB
const saveAudioBlob = async (blob: Blob): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([AUDIO_STORE], 'readwrite');
    const store = transaction.objectStore(AUDIO_STORE);
    const request = store.put(blob, 'currentRecording');
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Load audio blob from IndexedDB
const loadAudioBlob = async (): Promise<Blob | null> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([AUDIO_STORE], 'readonly');
      const store = transaction.objectStore(AUDIO_STORE);
      const request = store.get('currentRecording');
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to load audio blob:', error);
    return null;
  }
};

// Delete audio blob from IndexedDB
const deleteAudioBlob = async (): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([AUDIO_STORE], 'readwrite');
      const store = transaction.objectStore(AUDIO_STORE);
      const request = store.delete('currentRecording');
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to delete audio blob:', error);
  }
};

// Save backup to localStorage and IndexedDB
export const saveBackup = async (
  meetingInfo: { projectName: string; location: string; participants: string },
  notes: string,
  timestampMap: Map<number, number>,
  recordingStartTime: number,
  audioBlob: Blob | null,
  isSaved: boolean,
  transcriptions?: any[],
  rawTranscripts?: any[],
  speakersMap?: Map<number, string>,
  geminiSummary?: string
): Promise<void> => {
  try {
    // Convert Map to array for JSON serialization
    const timestampArray = Array.from(timestampMap.entries());
    const speakersArray = speakersMap ? Array.from(speakersMap.entries()) : undefined;
    
    const backupData: BackupData = {
      timestamp: Date.now(),
      meetingInfo,
      notes,
      timestampMap: timestampArray,
      speakersMap: speakersArray,
      recordingStartTime,
      hasAudioBlob: audioBlob !== null,
      isSaved,
      transcriptions,
      rawTranscripts,
      geminiSummary
    };
    
    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(backupData));
    
    // Save audio blob to IndexedDB if exists
    if (audioBlob) {
      await saveAudioBlob(audioBlob);
    }
    
    // console.log('💾 Auto-backup saved at', new Date().toLocaleTimeString());
  } catch (error) {
    console.error('Failed to save backup:', error);
  }
};

// Load backup from localStorage and IndexedDB
export const loadBackup = async (): Promise<{
  meetingInfo: { projectName: string; location: string; participants: string };
  notes: string;
  timestampMap: Map<number, number>;
  speakersMap: Map<number, string>;
  recordingStartTime: number;
  audioBlob: Blob | null;
  isSaved: boolean;
  backupTimestamp: number;
  transcriptions?: any[];
  rawTranscripts?: any[];
  geminiSummary?: string;
} | null> => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    
    const backupData: BackupData = JSON.parse(data);
    
    // Convert array back to Map
    const timestampMap = new Map(backupData.timestampMap);
    const speakersMap = backupData.speakersMap ? new Map(backupData.speakersMap) : new Map();
    
    // Load audio blob if it exists
    let audioBlob: Blob | null = null;
    if (backupData.hasAudioBlob) {
      audioBlob = await loadAudioBlob();
    }
    
    return {
      meetingInfo: backupData.meetingInfo,
      notes: backupData.notes,
      timestampMap,
      speakersMap,
      recordingStartTime: backupData.recordingStartTime,
      audioBlob,
      isSaved: backupData.isSaved,
      backupTimestamp: backupData.timestamp,
      transcriptions: backupData.transcriptions,
      rawTranscripts: backupData.rawTranscripts,
      geminiSummary: backupData.geminiSummary
    };
  } catch (error) {
    console.error('Failed to load backup:', error);
    return null;
  }
};

// Clear backup
export const clearBackup = async (): Promise<void> => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    await deleteAudioBlob();
    // console.log('🗑️ Auto-backup cleared');
  } catch (error) {
    console.error('Failed to clear backup:', error);
  }
};

// Check if backup exists
export const hasBackup = (): boolean => {
  return localStorage.getItem(STORAGE_KEY) !== null;
};

// Get backup age in minutes
export const getBackupAge = (): number | null => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    
    const backupData: BackupData = JSON.parse(data);
    const ageMs = Date.now() - backupData.timestamp;
    return Math.floor(ageMs / 60000); // Convert to minutes
  } catch (error) {
    return null;
  }
};
