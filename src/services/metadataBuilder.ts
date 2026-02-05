import type {
  MeetingInfo,
  MeetingMetadata
} from '../types/types';

export class MetadataBuilder {
  static buildMetadata(
    meetingInfo: MeetingInfo,
    notes: string,
    timestampMap: Map<number, number>,
    speakersMap: Map<number, string>,
    duration: number,
    audioFileName: string,
    recordingStartTime: number
  ) {
    // Extract timestamps from notes with proper text content
    const timestamps = this.extractTimestamps(notes, timestampMap, speakersMap, duration, recordingStartTime);

    // Meeting info JSON (compatible with C# SaveMeetingMetadataToJson)
    const meetingInfoJson: MeetingMetadata = {
      MeetingTitle: meetingInfo.title,
      MeetingDate: meetingInfo.date,
      MeetingTime: meetingInfo.time,
      Location: meetingInfo.location,
      Host: meetingInfo.host,
      Attendees: meetingInfo.attendees,
      CreatedAt: new Date().toISOString()
    };

    // Metadata JSON with new structure
    // Extract extension-agnostic project name (remove any audio extension)
    const projectName = audioFileName.replace(/\.(webm|mp3|wav|ogg|mp4)$/i, '');
    
    const metadataJson = {
      ProjectName: projectName,
      Model: 'Live Recording',
      Language: 'vi',
      OriginalFileName: audioFileName,
      AudioFileName: audioFileName,
      Duration: this.formatDurationWithMs(duration),
      RecordingStartTime: new Date(recordingStartTime).toISOString(), // Lưu thời điểm bắt đầu ghi âm
      Timestamps: timestamps
    };

    return {
      meetingInfo: meetingInfoJson,
      metadata: metadataJson
    };
  }

  private static extractTimestamps(
    notes: string,
    timestampMap: Map<number, number>,
    speakersMap: Map<number, string>,
    totalDuration: number,
    recordingStartTime: number
  ): Array<{ Index: number; Speaker: string; Text: string; DateTime: string; StartTime: string; EndTime: string; Highlight: boolean }> {
    const timestamps: Array<{ Index: number; Speaker: string; Text: string; DateTime: string; StartTime: string; EndTime: string; Highlight: boolean }> = [];
    
    // BLOCK_SEPARATOR is used in NotesEditor to separate lines
    const BLOCK_SEPARATOR = '§§§';
    const lines = notes.split(BLOCK_SEPARATOR);
    
    // Build map of position to line index
    const positionToLineIndex = new Map<number, number>();
    let currentPos = 0;
    for (let i = 0; i < lines.length; i++) {
      positionToLineIndex.set(currentPos, i);
      currentPos += lines[i].length + (i < lines.length - 1 ? BLOCK_SEPARATOR.length : 0);
    }
    
    // Convert timestampMap to array with line indices
    const lineTimestamps: Array<{ lineIndex: number; datetimeMs: number }> = [];
    timestampMap.forEach((datetimeMs, position) => {
      const lineIndex = positionToLineIndex.get(position);
      if (lineIndex !== undefined) {
        lineTimestamps.push({ lineIndex, datetimeMs });
      }
    });
    
    // Sort by datetime
    lineTimestamps.sort((a, b) => a.datetimeMs - b.datetimeMs);
    
    // Generate timestamp entries
    for (let i = 0; i < lineTimestamps.length; i++) {
      const { lineIndex, datetimeMs } = lineTimestamps[i];
      
      // Get text and speaker for this line
      const text = lines[lineIndex]?.trim() || '';
      const speaker = speakersMap.get(lineIndex) || '';
      
      // Skip empty lines
      if (!text) continue;
      
      // Calculate relative start time from recording start
      const startTimeMs = recordingStartTime > 0 ? Math.max(0, datetimeMs - recordingStartTime) : 0;
      
      // Find next timestamp or use total duration
      const nextDatetimeMs = i < lineTimestamps.length - 1 ? lineTimestamps[i + 1].datetimeMs : datetimeMs + 3000;
      const endTimeMs = recordingStartTime > 0 ? Math.min(nextDatetimeMs - recordingStartTime, totalDuration) : startTimeMs + 3000;

      timestamps.push({
        Index: timestamps.length,
        Speaker: speaker,
        Text: text,
        DateTime: new Date(datetimeMs).toISOString(),
        StartTime: this.formatDurationWithMs(startTimeMs),
        EndTime: this.formatDurationWithMs(endTimeMs),
        Highlight: false
      });
    }

    return timestamps;
  }

  static formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  // Format with milliseconds (HH:MM:SS.mmmmmmm)
  static formatDurationWithMs(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = ms % 1000;

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}0000`;
  }

  // Parse timestamp string to milliseconds
  static parseTimestamp(timeStr: string): number {
    const parts = timeStr.match(/(\d{2}):(\d{2}):(\d{2})/);
    if (!parts) return 0;

    const hours = parseInt(parts[1], 10);
    const minutes = parseInt(parts[2], 10);
    const seconds = parseInt(parts[3], 10);

    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }
}
