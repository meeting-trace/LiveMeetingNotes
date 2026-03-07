import React, { useRef, useState, useCallback } from "react";
import { Input } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import type { NoteLine } from "../types/types";

const { TextArea } = Input;

interface Props {
  notes: string;
  onNotesChange: (notes: string) => void;
  timestampMap: Map<number, number>;
  onTimestampMapChange: (map: Map<number, number>) => void;
  recordingStartTime: number;
  isLiveMode?: boolean; // true when recording/just recorded, false when loaded from project
  onSpeakersChange?: (speakers: Map<number, string>) => void; // Callback to sync speaker data
  initialSpeakers?: Map<number, string>; // Initial speakers data when loading project
  timestampDelay?: number; // Timestamp delay in seconds (from config, default: 8)
}

// Helper: Convert NoteLine[] to legacy format (for parent compatibility)
const linesToLegacyFormat = (lines: NoteLine[]) => {
  const BLOCK_SEPARATOR = "§§§";
  const notesString = lines.map((l) => l.content).join(BLOCK_SEPARATOR);

  const timestampMap = new Map<number, number>();
  const speakersMap = new Map<number, string>();

  let pos = 0;
  lines.forEach((line, index) => {
    if (line.timestamp !== undefined) {
      timestampMap.set(pos, line.timestamp);
    }
    if (line.speaker) {
      speakersMap.set(index, line.speaker);
    }
    pos += line.content.length;
    if (index < lines.length - 1) {
      pos += BLOCK_SEPARATOR.length;
    }
  });

  return { notesString, timestampMap, speakersMap };
};

// Helper: Convert legacy format to NoteLine[]
const legacyFormatToLines = (
  notes: string,
  timestampMap: Map<number, number>,
  speakersMap: Map<number, string>,
): NoteLine[] => {
  const BLOCK_SEPARATOR = "§§§";
  const contentArray = notes.split(BLOCK_SEPARATOR);

  const lines: NoteLine[] = contentArray.map((content, index) => ({
    content,
    timestamp: undefined,
    speaker: speakersMap.get(index),
  }));

  // Map position-based timestamps to line indices
  let pos = 0;
  lines.forEach((line, index) => {
    if (timestampMap.has(pos)) {
      line.timestamp = timestampMap.get(pos);
    }
    pos += line.content.length;
    if (index < lines.length - 1) {
      pos += BLOCK_SEPARATOR.length;
    }
  });

  return lines;
};

export const NotesEditor: React.FC<Props> = ({
  notes,
  onNotesChange,
  timestampMap,
  onTimestampMapChange,
  recordingStartTime,
  isLiveMode = true,
  onSpeakersChange,
  initialSpeakers,
  timestampDelay = 8, // Default 8 seconds
}) => {
  // const [showTimestamps, setShowTimestamps] = useState(true);
  const [showTimestamps] = useState(true);
  const [editingDatetimeIndex, setEditingDatetimeIndex] = useState<
    number | null
  >(null);
  const [editingDatetimeValue, setEditingDatetimeValue] = useState<string>("");

  const containerRef = useRef<HTMLDivElement>(null);
  const speakerRefs = useRef<Map<number, TextAreaRef>>(new Map());
  const textRefs = useRef<Map<number, TextAreaRef>>(new Map());
  const syncDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // ResizeObserver refs to sync speaker textarea height with content textarea
  const contentObserversRef = useRef<Map<number, ResizeObserver>>(new Map());

  // ✅ NEW CLEAN STATE: Single source of truth - array of NoteLine objects
  const [lines, setLines] = useState<NoteLine[]>(() =>
    legacyFormatToLines(notes, timestampMap, initialSpeakers || new Map()),
  );

  // Track if user is actively editing to prevent sync conflicts
  const isEditingRef = useRef<boolean>(false);
  const editingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track previous notes to detect project changes
  const previousNotesRef = useRef<string>(notes);

  // Track expected notes value after our own sync (to avoid false "external change" detection)
  const expectedNotesRef = useRef<string | null>(null);

  // Multi-line selection states
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [lastClickedLine, setLastClickedLine] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Undo/Redo history (now stores NoteLine[] directly)
  const [history, setHistory] = useState<Array<NoteLine[]>>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Sync lines when parent props change (load project, undo/redo from parent)
  React.useEffect(() => {
    // Check if notes prop changed from previous render
    const notesChanged = notes !== previousNotesRef.current;

    if (notesChanged) {
      // Check if this is OUR OWN SYNC (internal edit) or EXTERNAL CHANGE (load project)
      // If notes matches what we expect from our last sync, it's internal
      const isInternalSync = expectedNotesRef.current === notes;
      const isExternalChange = !isInternalSync;

      if (!isEditingRef.current || isExternalChange) {
        const newLines = legacyFormatToLines(
          notes,
          timestampMap,
          initialSpeakers || new Map(),
        );
        setLines(newLines);

        // 🔥 CRITICAL FIX: Reset history when loading new project (external change)
        // This prevents Ctrl+Z from restoring old project data
        if (isExternalChange) {
          setHistory([]);
          setHistoryIndex(-1);
          isEditingRef.current = false; // Reset editing flag when project changes
        }
      }

      previousNotesRef.current = notes;
      expectedNotesRef.current = null; // Clear expected value after processing
    }
  }, [notes, timestampMap, initialSpeakers]);

  // ✅ Sync to parent (convert NoteLine[] back to legacy format)
  const syncToParent = useCallback(
    (newLines: NoteLine[]) => {
      const {
        notesString,
        timestampMap: newTimestampMap,
        speakersMap,
      } = linesToLegacyFormat(newLines);

      // Store expected notes value to detect our own sync in useEffect
      expectedNotesRef.current = notesString;

      onNotesChange(notesString);
      onTimestampMapChange(newTimestampMap);
      if (onSpeakersChange) {
        onSpeakersChange(speakersMap);
      }
    },
    [onNotesChange, onTimestampMapChange, onSpeakersChange],
  );

  // Debounced sync to reduce parent updates during typing
  const debouncedSyncToParent = useCallback(
    (newLines: NoteLine[]) => {
      if (syncDebounceRef.current) {
        clearTimeout(syncDebounceRef.current);
      }

      syncDebounceRef.current = setTimeout(() => {
        syncToParent(newLines);
      }, 300);
    },
    [syncToParent],
  );

  // ✅ Listen for insert-note-at-time event from AudioPlayer (SIMPLIFIED)
  React.useEffect(() => {
    const handleInsertNote = (event: CustomEvent) => {
      const { time } = event.detail; // time in seconds
      const timestampMs = recordingStartTime + time * 1000;

      // Find where to insert based on timestamp order
      let insertIndex = lines.length; // Default: append at end

      for (let i = lines.length - 1; i >= 0; i--) {
        if (
          lines[i].timestamp !== undefined &&
          lines[i].timestamp! < timestampMs
        ) {
          insertIndex = i + 1;
          break;
        }
      }

      // If all lines have timestamps > new timestamp, insert at beginning
      if (
        insertIndex === lines.length &&
        lines.length > 0 &&
        lines[0].timestamp !== undefined &&
        timestampMs < lines[0].timestamp!
      ) {
        insertIndex = 0;
      }

      // ✅ Create new line and insert (ONE operation, no shifting needed!)
      const newLine: NoteLine = {
        content: "",
        timestamp: timestampMs,
        speaker: undefined,
      };

      const newLines = [...lines];
      newLines.splice(insertIndex, 0, newLine);

      setLines(newLines);
      syncToParent(newLines);

      // Focus the new line
      setTimeout(() => {
        const newTextRef = textRefs.current.get(insertIndex);
        const newText = newTextRef?.resizableTextArea?.textArea;
        if (newText) {
          newText.focus();
        }
      }, 50);
    };

    window.addEventListener(
      "insert-note-at-time",
      handleInsertNote as EventListener,
    );
    return () => {
      window.removeEventListener(
        "insert-note-at-time",
        handleInsertNote as EventListener,
      );
    };
  }, [lines, recordingStartTime, syncToParent]); // ✅ Clean dependencies

  const formatDatetime = (datetimeMs: number): string => {
    const date = new Date(datetimeMs);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const formatTimestamp = (datetimeMs: number): string => {
    // Format as relative time from recording start (HH:MM:SS)
    if (recordingStartTime === 0) return "00:00:00";

    const relativeMs = Math.max(0, datetimeMs - recordingStartTime);
    const totalSeconds = Math.floor(relativeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const parseDatetime = (dateStr: string): number | null => {
    // Format: yyyy-MM-dd HH:mm:ss
    const match = dateStr.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
    );
    if (!match) return null;

    const [, year, month, day, hours, minutes, seconds] = match;
    const date = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hours),
      parseInt(minutes),
      parseInt(seconds),
    );

    return date.getTime();
  };

  // ✅ Datetime click (REFACTORED with NoteLine[])
  const handleDatetimeClick = (index: number) => {
    const timeMs = lines[index].timestamp;
    if (timeMs !== undefined) {
      setEditingDatetimeIndex(index);
      setEditingDatetimeValue(formatDatetime(timeMs));
    }
  };

  const handleDatetimeChange = (value: string) => {
    setEditingDatetimeValue(value);
  };

  // ✅ Datetime blur (REFACTORED with NoteLine[])
  const handleDatetimeBlur = () => {
    if (editingDatetimeIndex !== null) {
      const newTimeMs = parseDatetime(editingDatetimeValue);
      if (newTimeMs !== null) {
        const newLines = [...lines];
        newLines[editingDatetimeIndex] = {
          ...newLines[editingDatetimeIndex],
          timestamp: newTimeMs,
        };
        setLines(newLines);
        syncToParent(newLines);
      }
    }
    setEditingDatetimeIndex(null);
    setEditingDatetimeValue("");
  };

  const handleDatetimeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleDatetimeBlur();
    } else if (e.key === "Escape") {
      setEditingDatetimeIndex(null);
      setEditingDatetimeValue("");
    }
  };

  // Handle line mouse down for selection (drag start)
  const handleLineMouseDown = (index: number, event: React.MouseEvent) => {
    // Don't interfere with text selection inside textarea (unless Ctrl/Shift is pressed)
    if (
      (event.target as HTMLElement).tagName === "TEXTAREA" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      // Clear selection on normal click
      setSelectedLines(new Set());
      return;
    }

    if (event.shiftKey && lastClickedLine !== null) {
      // Shift+Click: Select range
      event.preventDefault();
      // Blur any focused textarea to allow Delete/Backspace to work on selected lines
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const start = Math.min(lastClickedLine, index);
      const end = Math.max(lastClickedLine, index);
      const newSelected = new Set<number>();
      for (let i = start; i <= end; i++) {
        newSelected.add(i);
      }
      setSelectedLines(newSelected);
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl+Click: Toggle selection
      event.preventDefault();
      // Blur any focused textarea to allow Delete/Backspace to work on selected lines
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const newSelected = new Set(selectedLines);
      if (newSelected.has(index)) {
        newSelected.delete(index);
      } else {
        newSelected.add(index);
      }
      setSelectedLines(newSelected);
      setLastClickedLine(index);
    } else {
      // Normal mouse down: Start drag selection (only if not clicking inside textarea)
      if ((event.target as HTMLElement).tagName !== "TEXTAREA") {
        setIsDragging(true);
        const newSelected = new Set<number>();
        newSelected.add(index);
        setSelectedLines(newSelected);
        setLastClickedLine(index);
      }
    }
  };

  // Handle line mouse enter during drag
  const handleLineMouseEnter = (index: number) => {
    if (isDragging) {
      const newSelected = new Set(selectedLines);
      newSelected.add(index);
      setSelectedLines(newSelected);
    }
  };

  // ✅ Save current state to history (REFACTORED with NoteLine[])
  const saveToHistory = useCallback(() => {
    const newHistory = history.slice(0, historyIndex + 1);
    // Deep clone lines to avoid reference issues
    const linesCopy = lines.map((line) => ({ ...line }));
    newHistory.push(linesCopy);

    // Limit history to 50 entries
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
      setHistoryIndex(historyIndex + 1);
    }
    setHistory(newHistory);
  }, [lines, history, historyIndex]);

  // Handle delete selected lines
  // ✅ Handle delete selected lines (REFACTORED with NoteLine[])
  const handleDeleteSelected = useCallback(() => {
    if (selectedLines.size === 0) return;

    saveToHistory();

    // Delete from end to start to maintain correct indices
    const indicesToDelete = Array.from(selectedLines).sort((a, b) => b - a);
    const newLines = [...lines];

    indicesToDelete.forEach((idx) => {
      newLines.splice(idx, 1);
    });

    setLines(newLines);
    setSelectedLines(new Set());
    syncToParent(newLines);
  }, [selectedLines, lines, saveToHistory, syncToParent]);

  // ✅ Handle copy selected lines (REFACTORED with NoteLine[])
  const handleCopySelected = useCallback(() => {
    if (selectedLines.size === 0) return;

    const selectedIndices = Array.from(selectedLines).sort((a, b) => a - b);
    const textToCopy = selectedIndices
      .map((idx) => lines[idx].content)
      .join("\n");

    navigator.clipboard.writeText(textToCopy).then(() => {
      // console.log('📋 Copied selected lines to clipboard');
    });
  }, [selectedLines, lines]);

  // Global mouse up handler to end drag selection
  React.useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
      }
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, [isDragging]);

  // ✅ Global keyboard handler (REFACTORED with NoteLine[])
  React.useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z: Undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        if (historyIndex > 0) {
          e.preventDefault();
          const prevState = history[historyIndex - 1];
          setHistoryIndex(historyIndex - 1);
          setLines(prevState);
          syncToParent(prevState);
          setSelectedLines(new Set());
        }
      }
      // Ctrl+Shift+Z or Ctrl+Y: Redo
      else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.shiftKey && e.key === "z"))
      ) {
        if (historyIndex < history.length - 1) {
          e.preventDefault();
          const nextState = history[historyIndex + 1];
          setHistoryIndex(historyIndex + 1);
          setLines(nextState);
          syncToParent(nextState);
          setSelectedLines(new Set());
        }
      }
      // Ctrl+C: Copy selected lines
      else if (
        (e.ctrlKey || e.metaKey) &&
        e.key === "c" &&
        selectedLines.size > 0
      ) {
        if (document.activeElement?.tagName !== "TEXTAREA") {
          e.preventDefault();
          handleCopySelected();
        }
      }
      // Delete or Backspace: Delete selected lines
      else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedLines.size > 0
      ) {
        if (document.activeElement?.tagName !== "TEXTAREA") {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    history,
    historyIndex,
    selectedLines,
    syncToParent,
    handleCopySelected,
    handleDeleteSelected,
  ]);

  // ✅ Handle line content change (SIMPLIFIED with NoteLine[])
  const handleLineChange = (index: number, value: string) => {
    // Mark as actively editing
    isEditingRef.current = true;
    if (editingTimeoutRef.current) {
      clearTimeout(editingTimeoutRef.current);
    }
    editingTimeoutRef.current = setTimeout(() => {
      isEditingRef.current = false;
    }, 500);

    const oldLine = lines[index];
    const newLines = [...lines];
    newLines[index] = { ...oldLine, content: value };

    setLines(newLines);

    // Auto-create timestamp: Only in Live Mode when line goes from empty to having content
    if (isLiveMode) {
      const oldLineEmpty = oldLine.content.trim().length === 0;
      const newLineHasContent = value.trim().length > 0;

      if (
        oldLineEmpty &&
        newLineHasContent &&
        oldLine.timestamp === undefined
      ) {
        const currentDatetime = Date.now() - timestampDelay * 1000;
        newLines[index].timestamp = currentDatetime;
        setLines(newLines);
        syncToParent(newLines); // Immediate sync for timestamp creation
        return;
      }
    }

    // Debounced sync to parent
    debouncedSyncToParent(newLines);
  };

  // ✅ Handle speaker change (SIMPLIFIED with NoteLine[])
  const handleSpeakerChange = (index: number, value: string) => {
    const oldLine = lines[index];
    const newLines = [...lines];
    newLines[index] = { ...oldLine, speaker: value || undefined };

    setLines(newLines);

    // Auto-create timestamp: Only in Live Mode when speaker goes from empty to having content
    if (isLiveMode) {
      const oldSpeakerEmpty =
        !oldLine.speaker || oldLine.speaker.trim().length === 0;
      const newSpeakerHasContent = value.trim().length > 0;

      if (
        oldSpeakerEmpty &&
        newSpeakerHasContent &&
        oldLine.timestamp === undefined
      ) {
        const currentDatetime = Date.now() - timestampDelay * 1000;
        newLines[index].timestamp = currentDatetime;
        setLines(newLines);
        syncToParent(newLines); // Immediate sync
        return;
      }
    }

    debouncedSyncToParent(newLines);
  };

  // ✅ Handle speaker keyboard navigation (REFACTORED with NoteLine[])
  const handleSpeakerKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    const target = e.target as HTMLTextAreaElement;
    const cursorPos = target.selectionStart;
    const speakerText = target.value;

    // Enter (without Shift): Move to text column at end
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const textAreaRef = textRefs.current.get(index);
      const textArea = textAreaRef?.resizableTextArea?.textArea;
      if (textArea) {
        textArea.focus();
        textArea.setSelectionRange(
          textArea.value.length,
          textArea.value.length,
        );
      }
      return;
    }
    // Shift+Enter: Allow natural newline in speaker textarea (default behavior)

    // ArrowRight: Move to text column if cursor at end
    if (e.key === "ArrowRight" && cursorPos === speakerText.length) {
      e.preventDefault();
      const textAreaRef = textRefs.current.get(index);
      const textArea = textAreaRef?.resizableTextArea?.textArea;
      if (textArea) {
        textArea.focus();
        textArea.setSelectionRange(0, 0);
      }
      return;
    }

    // ArrowUp: Move to previous speaker textarea if cursor at beginning of first line
    if (e.key === "ArrowUp" && cursorPos === 0 && index > 0) {
      e.preventDefault();
      const prevSpeakerRef = speakerRefs.current.get(index - 1);
      const prevSpeaker = prevSpeakerRef?.resizableTextArea?.textArea;
      if (prevSpeaker) {
        prevSpeaker.focus();
        prevSpeaker.setSelectionRange(
          prevSpeaker.value.length,
          prevSpeaker.value.length,
        );
      }
      return;
    }

    // ArrowDown: Move to next speaker textarea if cursor at end of last line
    if (
      e.key === "ArrowDown" &&
      cursorPos === speakerText.length &&
      index < lines.length - 1
    ) {
      e.preventDefault();
      const nextSpeakerRef = speakerRefs.current.get(index + 1);
      const nextSpeaker = nextSpeakerRef?.resizableTextArea?.textArea;
      if (nextSpeaker) {
        nextSpeaker.focus();
        nextSpeaker.setSelectionRange(0, 0);
      }
      return;
    }
  };

  // ✅ Handle text keyboard input (REFACTORED with NoteLine[]) - no more shifting Maps!
  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    const currentLine = lines[index];
    const target = e.target as HTMLTextAreaElement;
    const cursorPos = target.selectionStart;

    // ArrowLeft: Move to speaker column if cursor at beginning
    if (e.key === "ArrowLeft" && cursorPos === 0) {
      e.preventDefault();
      const speakerAreaRef = speakerRefs.current.get(index);
      const speakerArea = speakerAreaRef?.resizableTextArea?.textArea;
      if (speakerArea) {
        speakerArea.focus();
        speakerArea.setSelectionRange(
          speakerArea.value.length,
          speakerArea.value.length,
        );
      }
      return;
    }

    // ArrowUp: Move to previous textarea if cursor at beginning
    if (e.key === "ArrowUp" && cursorPos === 0 && index > 0) {
      e.preventDefault();
      const prevTextRef = textRefs.current.get(index - 1);
      const prevText = prevTextRef?.resizableTextArea?.textArea;
      if (prevText) {
        prevText.focus();
        prevText.setSelectionRange(
          prevText.value.length,
          prevText.value.length,
        );
      }
      return;
    }

    // ArrowDown: Move to next textarea if cursor at end
    if (
      e.key === "ArrowDown" &&
      cursorPos === currentLine.content.length &&
      index < lines.length - 1
    ) {
      e.preventDefault();
      const nextTextRef = textRefs.current.get(index + 1);
      const nextText = nextTextRef?.resizableTextArea?.textArea;
      if (nextText) {
        nextText.focus();
        nextText.setSelectionRange(0, 0);
      }
      return;
    }

    // ===== ENTER KEY =====
    if (e.key === "Enter" && !e.shiftKey) {
      // In Loaded Mode: Let Enter behave like Shift+Enter (newline within the same textarea)
      if (!isLiveMode) {
        return; // Don't preventDefault - let textarea handle Enter naturally
      }

      // In Live Mode: Enter creates new line (new block) with timestamp
      e.preventDefault();
      saveToHistory(); // Save to history before creating new line

      // Split current line at cursor
      const beforeCursor = currentLine.content.substring(0, cursorPos);
      const afterCursor = currentLine.content.substring(cursorPos);

      const newLines = [...lines];
      newLines[index] = { ...currentLine, content: beforeCursor };

      // ✅ Insert new line after current (ONE splice, no shifting needed!)
      newLines.splice(index + 1, 0, {
        content: afterCursor,
        timestamp: undefined, // Will be created when user types (handleLineChange)
        speaker: undefined,
      });

      setLines(newLines);
      syncToParent(newLines);

      // Focus next line after React re-renders
      setTimeout(() => {
        const nextTextRef = textRefs.current.get(index + 1);
        const nextText = nextTextRef?.resizableTextArea?.textArea;
        if (nextText) {
          nextText.focus();
          nextText.setSelectionRange(0, 0);
        }
      }, 10);
      return;
    }
    // Shift+Enter: Allow natural newline (default browser behavior)

    // ===== BACKSPACE KEY =====
    if (e.key === "Backspace" && cursorPos === 0 && index > 0) {
      // Check if user has selected text
      const hasSelection = target.selectionStart !== target.selectionEnd;
      if (hasSelection) {
        return; // Let textarea handle selection deletion
      }

      e.preventDefault();
      saveToHistory(); // Save before merge/delete

      const newLines = [...lines];

      if (currentLine.content.trim().length === 0) {
        // Current line is empty → just remove it (ONE splice!)
        newLines.splice(index, 1);
        setLines(newLines);
        syncToParent(newLines);

        // Focus previous line at end
        setTimeout(() => {
          const prevTextRef = textRefs.current.get(index - 1);
          const prevText = prevTextRef?.resizableTextArea?.textArea;
          if (prevText) {
            prevText.focus();
            prevText.setSelectionRange(
              prevText.value.length,
              prevText.value.length,
            );
          }
        }, 10);
      } else {
        // Current line has content → merge with previous
        const prevLine = newLines[index - 1];
        const prevLength = prevLine.content.length;

        newLines[index - 1] = {
          ...prevLine,
          content: prevLine.content + currentLine.content,
        };
        newLines.splice(index, 1); // Remove current line
        setLines(newLines);
        syncToParent(newLines);

        // Focus previous line at merge point
        setTimeout(() => {
          const prevTextRef = textRefs.current.get(index - 1);
          const prevText = prevTextRef?.resizableTextArea?.textArea;
          if (prevText) {
            prevText.focus();
            prevText.setSelectionRange(prevLength, prevLength);
          }
        }, 10);
      }
      return;
    }

    // ===== DELETE KEY =====
    if (
      e.key === "Delete" &&
      currentLine.content.trim().length === 0 &&
      lines.length > 1
    ) {
      e.preventDefault();
      saveToHistory();

      // Delete empty line (ONE splice!)
      const newLines = [...lines];
      newLines.splice(index, 1);
      setLines(newLines);
      syncToParent(newLines);

      // Focus current position (which will now be the next line)
      setTimeout(() => {
        const focusIndex = Math.min(index, newLines.length - 1);
        const focusTextRef = textRefs.current.get(focusIndex);
        const focusText = focusTextRef?.resizableTextArea?.textArea;
        if (focusText) {
          focusText.focus();
        }
      }, 10);
    }
  };

  // ✅ Datetime double-click for audio seek (REFACTORED with NoteLine[])
  const handleDatetimeDoubleClick = (
    e: React.MouseEvent,
    lineIndex: number,
  ) => {
    e.stopPropagation();
    const datetimeMs = lines[lineIndex].timestamp;
    if (datetimeMs !== undefined && recordingStartTime > 0) {
      // Convert datetime to relative time from recording start
      const relativeTimeMs = datetimeMs - recordingStartTime;
      window.dispatchEvent(
        new CustomEvent("seek-audio", {
          detail: { time: Math.max(0, relativeTimeMs) / 1000 },
        }),
      );
    }
  };

  // ✅ Render section (REFACTORED with NoteLine[])
  return (
    <div className="notes-editor-container">
      <div className="editor-header">
        <h3>📝 Ghi chép thủ công</h3>
        <div className="editor-controls">
          <span className="recording-hint">
            {isLiveMode
              ? "💡 Gõ để tạo ngày giờ • Enter để xuống dòng mới • Shift+Enter để ngắt dòng"
              : "💡 Nhấp chuột phải vào sóng âm để chèn ghi chú • Enter/Shift+Enter để ngắt dòng trong văn bản"}
          </span>
          {/* <button
            className="toggle-timestamps-btn"
            onClick={() => setShowTimestamps(!showTimestamps)}
            title={showTimestamps ? (isLiveMode ? 'Ẩn ngày giờ' : 'Ẩn mốc thời gian') : (isLiveMode ? 'Hiện ngày giờ' : 'Hiện mốc thời gian')}
          >
            {showTimestamps ? (isLiveMode ? '👁️ Ẩn ngày giờ' : '👁️ Ẩn mốc thời gian') : (isLiveMode ? '👁️‍🗨️ Hiện ngày giờ' : '👁️‍🗨️ Hiện mốc thời gian')}
          </button> */}
        </div>
      </div>

      <div
        ref={containerRef}
        style={{
          border: "1px solid #d1dae8",
          borderRadius: "8px",
          backgroundColor: "#f0f4fa",
          maxHeight: "500px",
          overflowY: "auto",
        }}
      >
        {lines.map((line, index) => {
          const timeMs = line.timestamp; // ✅ Read from NoteLine object
          const isSelected = selectedLines.has(index);
          return (
            <div
              key={index}
              onMouseDown={(e) => handleLineMouseDown(index, e)}
              onMouseEnter={() => handleLineMouseEnter(index)}
              style={{
                display: "flex",
                borderBottom:
                  index < lines.length - 1 ? "1px solid #e8eef8" : "none",
                backgroundColor: isSelected
                  ? "rgba(79, 70, 229, 0.08)"
                  : "transparent",
                outline: isSelected
                  ? "2px solid rgba(79, 70, 229, 0.40)"
                  : "none",
                outlineOffset: "-2px",
                userSelect: "none",
              }}
            >
              {/* Timestamp Column */}
              <div
                onClick={() =>
                  editingDatetimeIndex !== index &&
                  timeMs !== undefined &&
                  isLiveMode &&
                  handleDatetimeClick(index)
                }
                onDoubleClick={(e) =>
                  timeMs !== undefined && handleDatetimeDoubleClick(e, index)
                }
                style={{
                  width: isLiveMode ? "160px" : "90px",
                  backgroundColor: isSelected
                    ? "rgba(79, 70, 229, 0.12)"
                    : "#f0f4fa",
                  borderRight: "1px solid #d1dae8",
                  padding: "8px",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  color: timeMs !== undefined ? "#4f46e5" : "transparent",
                  textAlign: "right",
                  cursor: timeMs !== undefined ? "pointer" : "default",
                  userSelect: editingDatetimeIndex === index ? "text" : "none",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "flex-start",
                  paddingTop: "8px",
                }}
                title={
                  timeMs !== undefined
                    ? isLiveMode
                      ? "Nhấn để chỉnh sửa • Nhấp đúp để chuyển đến âm thanh"
                      : "Nhấp đúp để chuyển đến âm thanh"
                    : ""
                }
              >
                {editingDatetimeIndex === index && isLiveMode ? (
                  <Input
                    value={editingDatetimeValue}
                    onChange={(e) => handleDatetimeChange(e.target.value)}
                    onBlur={handleDatetimeBlur}
                    onKeyDown={handleDatetimeKeyDown}
                    autoFocus
                    size="small"
                    style={{
                      fontFamily: "monospace",
                      fontSize: "13px",
                      padding: "2px 4px",
                      width: "144px",
                      backgroundColor: "#ffffff",
                      color: "#5046e4",
                      border: "1px solid #5046e4",
                    }}
                  />
                ) : timeMs !== undefined && showTimestamps ? (
                  isLiveMode ? (
                    formatDatetime(timeMs)
                  ) : (
                    formatTimestamp(timeMs)
                  )
                ) : (
                  "\u00A0"
                )}
              </div>

              {/* Speaker Name TextArea */}
              <div
                style={{
                  width: "120px",
                  backgroundColor: isSelected
                    ? "rgba(79, 70, 229, 0.12)"
                    : "#f0f4fa",
                  borderRight: "1px solid #d1dae8",
                  padding: "0",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "flex-start",
                }}
              >
                <TextArea
                  ref={(el) => {
                    if (el) {
                      speakerRefs.current.set(index, el);
                    } else {
                      speakerRefs.current.delete(index);
                    }
                  }}
                  value={line.speaker || ""} // ✅ Read from NoteLine object
                  onChange={(e) => handleSpeakerChange(index, e.target.value)}
                  onKeyDown={(e) => handleSpeakerKeyDown(index, e)}
                  placeholder="Người nói"
                  autoSize={{ minRows: 1, maxRows: 10 }}
                  style={{
                    fontFamily: "monospace",
                    fontSize: "13px",
                    padding: "8px",
                    width: "100%",
                    backgroundColor: "transparent",
                    color: "#0891b2",
                    resize: "none",
                  }}
                />
              </div>

              {/* Text Input */}
              <TextArea
                ref={(el) => {
                  if (el) {
                    textRefs.current.set(index, el);
                    // Directly sync speaker textarea minHeight via DOM to avoid autoSize override
                    const textarea = el.resizableTextArea?.textArea;
                    if (textarea) {
                      contentObserversRef.current.get(index)?.disconnect();
                      const observer = new ResizeObserver(() => {
                        const h = textarea.offsetHeight;
                        if (h > 0) {
                          const speakerRef = speakerRefs.current.get(index);
                          const speakerTextarea =
                            speakerRef?.resizableTextArea?.textArea;
                          if (speakerTextarea) {
                            speakerTextarea.style.minHeight = `${h}px`;
                          }
                        }
                      });
                      observer.observe(textarea);
                      contentObserversRef.current.set(index, observer);
                    }
                  } else {
                    textRefs.current.delete(index);
                    contentObserversRef.current.get(index)?.disconnect();
                    contentObserversRef.current.delete(index);
                  }
                }}
                value={line.content} // ✅ Read from NoteLine object
                onChange={(e) => {
                  let newValue = e.target.value;
                  // Auto-capitalize first character when user starts typing in an empty field
                  if (line.content.length === 0 && newValue.length === 1) {
                    newValue = newValue.toUpperCase();
                  }
                  handleLineChange(index, newValue);
                }}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onMouseDown={(e) => {
                  // If Ctrl or Shift is pressed, prevent focus and let parent handle selection
                  if (e.ctrlKey || e.metaKey || e.shiftKey) {
                    e.preventDefault();
                  }
                }}
                onInput={(e) => {
                  // Handle undo/redo operations
                  const target = e.target as HTMLTextAreaElement;
                  handleLineChange(index, target.value);
                }}
                placeholder="Nhập ghi chú ..."
                autoSize={{ minRows: 1, maxRows: 10 }}
                style={{
                  flex: 1,
                  fontFamily: "monospace",
                  fontSize: "14px",
                  lineHeight: "1.6",
                  backgroundColor: "transparent",
                  resize: "none",
                  padding: "8px",
                  color: "#1e293b",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
