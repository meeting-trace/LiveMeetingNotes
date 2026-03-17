import React, { useState, useRef, useCallback } from "react";
import {
  Modal,
  Checkbox,
  Button,
  Space,
  Progress,
  Typography,
  Tag,
  Alert,
} from "antd";
import {
  HolderOutlined,
  SoundOutlined,
  MergeCellsOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { AudioMerger } from "../services/audioMerger";

const { Text } = Typography;

export interface AudioFileItem {
  name: string;
  blob: Blob;
}

interface Props {
  open: boolean;
  audioFiles: AudioFileItem[];
  onConfirm: (mergedBlob: Blob) => void; // Called with merged result
  onCancel: () => void;
  onUseSingle: (blob: Blob) => void; // Use only first file (skip merge)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getFormatTag(name: string): string {
  return name.split(".").pop()?.toUpperCase() || "?";
}

const FORMAT_COLORS: Record<string, string> = {
  WEBM: "blue",
  MP3: "green",
  WAV: "cyan",
  OGG: "purple",
  MP4: "orange",
  M4A: "orange",
  AAC: "volcano",
  FLAC: "geekblue",
};

export const AudioFileMergeDialog: React.FC<Props> = ({
  open,
  audioFiles,
  onConfirm,
  onCancel,
  onUseSingle,
}) => {
  const [items, setItems] = useState<
    (AudioFileItem & { checked: boolean; id: string })[]
  >(() =>
    audioFiles.map((f, i) => ({ ...f, checked: true, id: `audio-${i}` })),
  );
  const [merging, setMerging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const { t } = useTranslation();

  // Reset items when audioFiles prop changes (dialog reopens)
  React.useEffect(() => {
    setItems(
      audioFiles.map((f, i) => ({ ...f, checked: true, id: `audio-${i}` })),
    );
    setProgress(0);
  }, [audioFiles]);

  const selectedCount = items.filter((it) => it.checked).length;

  // --- Drag & Drop Handlers ---
  const handleDragStart = useCallback((id: string) => {
    dragIdRef.current = id;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverId(id);
  }, []);

  const handleDrop = useCallback((targetId: string) => {
    const srcId = dragIdRef.current;
    if (!srcId || srcId === targetId) {
      setDragOverId(null);
      return;
    }
    setItems((prev) => {
      const arr = [...prev];
      const srcIdx = arr.findIndex((x) => x.id === srcId);
      const tgtIdx = arr.findIndex((x) => x.id === targetId);
      if (srcIdx === -1 || tgtIdx === -1) return prev;
      const [removed] = arr.splice(srcIdx, 1);
      arr.splice(tgtIdx, 0, removed);
      return arr;
    });
    dragIdRef.current = null;
    setDragOverId(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragIdRef.current = null;
    setDragOverId(null);
  }, []);

  // --- Move up/down buttons ---
  const moveItem = (id: string, direction: -1 | 1) => {
    setItems((prev) => {
      const arr = [...prev];
      const idx = arr.findIndex((x) => x.id === id);
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= arr.length) return prev;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  };

  // --- Toggle check ---
  const toggleCheck = (id: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, checked: !it.checked } : it)),
    );
  };

  // --- Merge Action ---
  const handleMerge = async () => {
    const selected = items.filter((it) => it.checked);
    if (selected.length === 0) return;

    if (selected.length === 1) {
      onConfirm(selected[0].blob);
      return;
    }

    setMerging(true);
    setProgress(0);
    try {
      const merged = await AudioMerger.mergeAudioBlobs(
        selected.map((it) => it.blob),
        (p) => setProgress(Math.round(p * 100)),
      );
      onConfirm(merged);
    } catch (err) {
      console.error("❌ Merge failed:", err);
      Modal.error({
        title: t('audioMerge.errorTitle'),
        content: t('audioMerge.errorContent', { error: err instanceof Error ? err.message : String(err) }),
      });
    } finally {
      setMerging(false);
    }
  };

  const hasMultipleFormats = (() => {
    const selectedItems = items.filter((it) => it.checked);
    if (selectedItems.length < 2) return false;
    const exts = new Set(
      selectedItems.map((it) => it.name.split(".").pop()?.toLowerCase()),
    );
    return exts.size > 1;
  })();

  // Footer buttons
  const footer = (
    <Space style={{ width: "100%", justifyContent: "flex-end" }}>
      <Button onClick={onCancel} disabled={merging}>
        {t('audioMerge.cancel')}
      </Button>
      {audioFiles.length > 0 && (
        <Button
          onClick={() => onUseSingle(items[0].blob)}
          disabled={merging}
          title={t('audioMerge.useFirstOnlyTitle')}
        >
          {t('audioMerge.useFirstOnly')}
        </Button>
      )}
      <Button
        type="primary"
        icon={<MergeCellsOutlined />}
        onClick={handleMerge}
        disabled={merging || selectedCount === 0}
        loading={merging}
      >
        {selectedCount <= 1
          ? t('audioMerge.loadSelected')
          : t('audioMerge.mergeAndLoad', { count: selectedCount })}
      </Button>
    </Space>
  );

  return (
    <Modal
      open={open}
      title={
        <Space>
          <MergeCellsOutlined style={{ color: "#1890ff" }} />
          <span>{t('audioMerge.title')}</span>
        </Space>
      }
      footer={footer}
      onCancel={onCancel}
      closable={!merging}
      maskClosable={!merging}
      width={560}
      styles={{ body: { padding: "16px 0" } }}
    >
      <div style={{ padding: "0 24px" }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('audioMerge.found', { count: audioFiles.length })}
          description={
            <span>
              {t('audioMerge.instructions')}
            </span>
          }
        />

        {hasMultipleFormats && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('audioMerge.mixedFormats')}
            description={t('audioMerge.mixedFormatsDesc')}
          />
        )}

        {/* File list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item, idx) => {
            const fmt = getFormatTag(item.name);
            const color = FORMAT_COLORS[fmt] || "default";
            const isOver = dragOverId === item.id;

            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => handleDragStart(item.id)}
                onDragOver={(e) => handleDragOver(e, item.id)}
                onDrop={() => handleDrop(item.id)}
                onDragEnd={handleDragEnd}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: isOver ? "2px dashed #1890ff" : "1px solid #d9d9d9",
                  background: item.checked ? "#f6ffed" : "#fafafa",
                  opacity: item.checked ? 1 : 0.55,
                  cursor: "grab",
                  transition: "border 0.15s, background 0.15s",
                  userSelect: "none",
                }}
              >
                {/* Drag handle */}
                <HolderOutlined
                  style={{ color: "#aaa", fontSize: 16, cursor: "grab" }}
                />

                {/* Checkbox */}
                <Checkbox
                  checked={item.checked}
                  onChange={() => toggleCheck(item.id)}
                  onClick={(e) => e.stopPropagation()}
                />

                {/* Order badge */}
                <Text
                  type="secondary"
                  style={{
                    minWidth: 22,
                    textAlign: "center",
                    fontSize: 12,
                    background: "#e6f7ff",
                    borderRadius: 4,
                    padding: "1px 5px",
                  }}
                >
                  {idx + 1}
                </Text>

                {/* Icon */}
                <SoundOutlined style={{ color: "#1890ff" }} />

                {/* File name */}
                <Text
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={item.name}
                >
                  {item.name}
                </Text>

                {/* Format tag */}
                <Tag color={color} style={{ flexShrink: 0 }}>
                  {fmt}
                </Tag>

                {/* Size */}
                <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                  {formatBytes(item.blob.size)}
                </Text>

                {/* Move buttons */}
                <Space.Compact size="small">
                  <Button
                    size="small"
                    icon={<ArrowUpOutlined />}
                    disabled={idx === 0 || merging}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveItem(item.id, -1);
                    }}
                  />
                  <Button
                    size="small"
                    icon={<ArrowDownOutlined />}
                    disabled={idx === items.length - 1 || merging}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveItem(item.id, 1);
                    }}
                  />
                </Space.Compact>

                {/* Deselect quick button */}
                <Button
                  size="small"
                  type="text"
                  icon={<DeleteOutlined />}
                  danger
                  disabled={merging}
                  title={t('audioMerge.deselectFile')}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCheck(item.id);
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Summary + progress */}
        <div style={{ marginTop: 16 }}>
          {selectedCount > 0 && !merging && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              <CheckCircleOutlined
                style={{ color: "#52c41a", marginRight: 4 }}
              />
              Đã chọn {selectedCount} / {items.length} file ·{" "}
              {formatBytes(
                items
                  .filter((it) => it.checked)
                  .reduce((s, it) => s + it.blob.size, 0),
              )}{" "}
              tổng
            </Text>
          )}
          {merging && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {progress < 50
                  ? `Đang giải mã file âm thanh... (${progress}%)`
                  : progress < 90
                    ? `Đang ghép dữ liệu PCM... (${progress}%)`
                    : `Đang ghi file WAV... (${progress}%)`}
              </Text>
              <Progress
                percent={progress}
                status="active"
                size="small"
                style={{ marginTop: 4 }}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
