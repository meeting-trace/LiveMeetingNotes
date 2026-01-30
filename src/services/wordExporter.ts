import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import type { MeetingInfo, TranscriptionResult } from '../types/types';

// Helper function to add timestamp prefix to filename
function addTimestampPrefix(fileName: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const prefix = `${year}${month}${day}_${hours}${minutes}_`;
  return prefix + fileName;
}

export class WordExporter {
  // Create Word blob without downloading
  static async createWordBlob(
    meetingInfo: MeetingInfo,
    notesText: string,
    transcriptions?: TranscriptionResult[],
    speakersMap?: Map<number, string>,
    geminiSummary?: string // Add summary parameter
  ): Promise<Blob> {
    // Text is already clean (no timestamps embedded)
    const paragraphs = this.parseTextToParagraphs(notesText, speakersMap);
    
    console.log('transcriptions in createWordBlob:', transcriptions);

    // Add summary section if available
    const summaryParagraphs = geminiSummary
      ? this.createSummaryParagraphs(geminiSummary)
      : [];

    // Add transcription section if available
    const transcriptionParagraphs = transcriptions && transcriptions.length > 0
      ? this.createTranscriptionParagraphs(transcriptions)
      : [];
    
    // Create document
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            // Title
            new Paragraph({
              text: 'BÁO CÁO CUỘC HỌP',
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 }
            }),
            
            // Meeting information
            new Paragraph({
              text: 'THÔNG TIN CUỘC HỌP',
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 200 }
            }),
            
            new Paragraph({
              children: [
                new TextRun({ text: 'Nội dung: ', bold: true, size: 24 }),
                new TextRun({ text: meetingInfo.title, size: 24 })
              ],
              spacing: { after: 100 }
            }),
            
            new Paragraph({
              children: [
                new TextRun({ text: 'Ngày: ', bold: true, size: 24 }),
                new TextRun({ text: meetingInfo.date, size: 24 })
              ],
              spacing: { after: 100 }
            }),
            
            new Paragraph({
              children: [
                new TextRun({ text: 'Giờ: ', bold: true, size: 24 }),
                new TextRun({ text: meetingInfo.time, size: 24 })
              ],
              spacing: { after: 100 }
            }),
            
            new Paragraph({
              children: [
                new TextRun({ text: 'Địa điểm: ', bold: true, size: 24 }),
                new TextRun({ text: meetingInfo.location || 'N/A', size: 24 })
              ],
              spacing: { after: 100 }
            }),
            
            new Paragraph({
              children: [
                new TextRun({ text: 'Chủ trì: ', bold: true, size: 24 }),
                new TextRun({ text: meetingInfo.host || 'N/A', size: 24 })
              ],
              spacing: { after: 100 }
            }),
            
            new Paragraph({
              children: [
                new TextRun({ text: 'Thành phần tham dự: ', bold: true, size: 24 }),
                new TextRun({ text: meetingInfo.attendees || 'N/A', size: 24 })
              ],
              spacing: { after: 300 }
            }),
            
            // Add summary section if available (before transcription)
            ...summaryParagraphs,

            // Notes content
            new Paragraph({
              text: 'NỘI DUNG CUỘC HỌP CHI TIẾT',
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 200 },
              alignment: AlignmentType.JUSTIFIED
            }),
            
            ...paragraphs,
            

            
            // Add transcription section if available
            ...transcriptionParagraphs
          ]
        }
      ]
    });
    
    // Generate blob
    const { Packer } = await import('docx');
    return await Packer.toBlob(doc);
  }

  // Export with auto-download (for fallback browsers)
  static async exportToWord(
    meetingInfo: MeetingInfo,
    notesText: string,
    fileName: string,
    transcriptions?: TranscriptionResult[],
    speakersMap?: Map<number, string>,
    geminiSummary?: string
  ): Promise<void> {
    console.log('transcriptions:', transcriptions);
    const fileNameWithTimestamp = addTimestampPrefix(fileName);
    const blob = await this.createWordBlob(meetingInfo, notesText, transcriptions, speakersMap, geminiSummary);
    saveAs(blob, fileNameWithTimestamp);
  }
  
  private static parseTextToParagraphs(text: string, speakersMap?: Map<number, string>): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    
    // BLOCK_SEPARATOR is used in NotesEditor to separate lines
    const BLOCK_SEPARATOR = '§§§';
    
    // First split by BLOCK_SEPARATOR to get individual notes/lines
    let lines = text.split(BLOCK_SEPARATOR);
    
    // Process each line with its speaker (if available)
    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim();
      const speaker = speakersMap?.get(lineIndex);
      
      // If speaker exists, prepend it in bold
      if (speaker && speaker.trim()) {
        if (trimmed) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${speaker.trim()}: `, bold: true, size: 24 }),
                new TextRun({ text: trimmed, size: 24 })
              ],
              spacing: { after: 100 },
              alignment: AlignmentType.JUSTIFIED
            })
          );
        } else {
          // Empty line with just speaker name
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${speaker.trim()}: `, bold: true, size: 24 })
              ],
              spacing: { after: 100 },
              alignment: AlignmentType.JUSTIFIED
            })
          );
        }
      } else {
        // No speaker, just text
        if (trimmed) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: trimmed, size: 24 })
              ],
              spacing: { after: 100 },
              alignment: AlignmentType.JUSTIFIED
            })
          );
        } else {
          // Empty line for spacing
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: '', size: 24 })
              ],
              spacing: { after: 50 },
              alignment: AlignmentType.JUSTIFIED
            })
          );
        }
      }
    });
    
    return paragraphs;
  }
  
  // Create paragraphs for transcription results
  private static createTranscriptionParagraphs(transcriptions: TranscriptionResult[]): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    
    // Add heading
    paragraphs.push(
      new Paragraph({
        text: 'SPEECH-TO-TEXT',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
        alignment: AlignmentType.JUSTIFIED
      })
    );
    
    // Add transcription items
  transcriptions.forEach((item, index) => {
    // Format startTime if available
    let timeStr = '';
    if (item.startTime) {
      const date = new Date(item.startTime);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      timeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
      
      // Create paragraph with speaker and timestamp
      const prefix = `[${index + 1}] ${item.speaker}${timeStr ? ` (${timeStr})` : ''}: `;
      
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: prefix, bold: true, size: 24 }),
            new TextRun({ text: item.text, size: 24 })
          ],
          spacing: { after: 150 },
          alignment: AlignmentType.JUSTIFIED
        })
      );
    });
    
    return paragraphs;
  }
  
  // Create paragraphs for Gemini AI summary
  private static createSummaryParagraphs(summary: string): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    
    // Add heading
    paragraphs.push(
      new Paragraph({
        text: 'TÓM TẮT NỘI DUNG',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
        alignment: AlignmentType.JUSTIFIED
      })
    );
    
    // Split summary into paragraphs if it contains line breaks
    const summaryLines = summary.split('\n').filter(line => line.trim());
    
    summaryLines.forEach(line => {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: line.trim(), size: 24 })
          ],
          spacing: { after: 150 },
          alignment: AlignmentType.JUSTIFIED
        })
      );
    });
    
    return paragraphs;
  }
}
