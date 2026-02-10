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
              text: 'THÔNG TIN CHUNG',
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
    
    // Split summary into lines
    const lines = summary.split('\n');
    
    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        // Empty line - add spacing
        paragraphs.push(new Paragraph({ text: '', spacing: { after: 100 } }));
        return;
      }
      
      // Parse markdown formatting and create paragraph
      const paragraph = this.parseMarkdownLine(trimmedLine);
      paragraphs.push(paragraph);
    });
    
    return paragraphs;
  }

  /**
   * Parse a line with markdown formatting and convert to Word paragraph
   * Supports: **bold**, bullet points (*, -, •), numbered lists (1. 2. 3.), headings, nested bullets
   */
  private static parseMarkdownLine(line: string): Paragraph {
    // Detect indentation level (for nested bullets)
    const indentMatch = line.match(/^(\s+)/);
    const indentSpaces = indentMatch ? indentMatch[1].length : 0;
    const level = Math.min(Math.floor(indentSpaces / 2), 4); // Max 4 levels, 2 spaces per level
    const trimmedLine = line.trim();
    
    // Check for bullet point (*, -, •)
    const bulletMatch = trimmedLine.match(/^[\*\-\•]\s+(.+)$/);
    if (bulletMatch) {
      const text = bulletMatch[1];
      return new Paragraph({
        children: this.parseMarkdownText(text),
        bullet: { level: level },
        spacing: { after: 100 },
        alignment: AlignmentType.JUSTIFIED
      });
    }
    
    // Check for numbered list (1. 2. 3.)
    const numberMatch = trimmedLine.match(/^(\d+)\.\s+(.+)$/);
    if (numberMatch) {
      const number = numberMatch[1];
      const text = numberMatch[2];
      // Use bullet with number prefix instead of numbering (simpler, no config needed)
      return new Paragraph({
        children: [
          new TextRun({ text: `${number}. `, bold: true, size: 24 }),
          ...this.parseMarkdownText(text)
        ],
        bullet: { level: level },
        spacing: { after: 100 },
        alignment: AlignmentType.JUSTIFIED
      });
    }
    
    // Check for markdown heading (## or ###)
    const headingMatch = trimmedLine.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      const text = headingMatch[1];
      return new Paragraph({
        children: this.parseMarkdownText(text),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 150 },
        alignment: AlignmentType.JUSTIFIED
      });
    }
    
    // Regular paragraph
    return new Paragraph({
      children: this.parseMarkdownText(trimmedLine),
      spacing: { after: 150 },
      alignment: AlignmentType.JUSTIFIED
    });
  }

  /**
   * Parse inline markdown formatting (bold, italic) in text
   * Returns array of TextRun with appropriate formatting
   */
  private static parseMarkdownText(text: string): TextRun[] {
    const runs: TextRun[] = [];
    
    // Regex to find **bold** patterns
    const boldPattern = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match;
    
    while ((match = boldPattern.exec(text)) !== null) {
      // Add text before bold
      if (match.index > lastIndex) {
        const beforeText = text.substring(lastIndex, match.index);
        if (beforeText) {
          runs.push(new TextRun({ text: beforeText, size: 24 }));
        }
      }
      
      // Add bold text
      runs.push(new TextRun({ 
        text: match[1], 
        bold: true, 
        size: 24 
      }));
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text after last bold
    if (lastIndex < text.length) {
      const afterText = text.substring(lastIndex);
      if (afterText) {
        runs.push(new TextRun({ text: afterText, size: 24 }));
      }
    }
    
    // If no bold found, return single run
    if (runs.length === 0) {
      runs.push(new TextRun({ text: text, size: 24 }));
    }
    
    return runs;
  }
}
