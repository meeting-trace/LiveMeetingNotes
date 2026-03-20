import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import 'flag-icons/css/flag-icons.min.css';
import { WORLD_LANGUAGES, DEFAULT_AVAILABLE_LANGUAGES } from '../constants/worldLanguages';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Checkbox,
  Button,
  Space,
  App,
  Collapse,
  Spin,
  Switch,
} from "antd";
import {
  SettingOutlined,
  SaveOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { SpeechToTextConfig, GeminiModel } from "../types/types";

// ── Inline language checkbox grid ────────────────────────────────────────────
interface LangGridProps {
  value?: string[];
  onChange?: (val: string[]) => void;
}
const LanguageCheckGrid: React.FC<LangGridProps> = ({ value = [], onChange }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return WORLD_LANGUAGES;
    return WORLD_LANGUAGES.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.englishName.toLowerCase().includes(q) ||
      l.keywords.toLowerCase().includes(q) ||
      l.value.toLowerCase().includes(q)
    );
  }, [query]);
  const toggle = (code: string) => {
    const next = value.includes(code)
      ? value.filter(v => v !== code)
      : [...value, code];
    onChange?.(next);
  };
  return (
    <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
      {/* Search + count bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', borderBottom: '1px solid #f0f0f0', background: '#fafafa',
      }}>
        <SearchOutlined style={{ color: '#8c8c8c', flexShrink: 0 }} />
        <Input
          size="small"
          variant="borderless"
          placeholder={t('config.availableLangsSearch')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ flex: 1, padding: 0 }}
          allowClear
        />
        <span style={{ fontSize: 12, color: '#595959', flexShrink: 0 }}>
          {t('config.availableLangsCount', { count: value.length, total: WORLD_LANGUAGES.length })}
        </span>
      </div>
      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 0,
        maxHeight: 320,
        overflowY: 'auto',
        padding: '4px 0',
      }}>
        {filtered.map(l => (
          <label
            key={l.value}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '5px 12px', cursor: 'pointer',
              borderRadius: 4,
              background: value.includes(l.value) ? '#e6f4ff' : 'transparent',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { if (!value.includes(l.value)) (e.currentTarget as HTMLElement).style.background = '#f5f5f5'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = value.includes(l.value) ? '#e6f4ff' : 'transparent'; }}
          >
            <Checkbox
              checked={value.includes(l.value)}
              onChange={() => toggle(l.value)}
              style={{ flexShrink: 0 }}
            />
            <span className={`fi fi-${l.fiCode}`} style={{ fontSize: 14, borderRadius: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 13, lineHeight: 1.3, minWidth: 0, overflow: 'hidden' }}>
              <span style={{ fontWeight: value.includes(l.value) ? 600 : 400, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>
              <span style={{ fontSize: 11, color: '#8c8c8c', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.englishName}</span>
            </span>
          </label>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: '16px', textAlign: 'center', color: '#8c8c8c', gridColumn: '1/-1' }}>
            {t('config.availableLangsNoResult')}
          </div>
        )}
      </div>
    </div>
  );
};
import { SpeechToTextService } from "../services/speechToText";
import { AIRefinementService } from "../services/aiRefinement";
import { UpdateManagerService } from "../services/updateManager";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (config: SpeechToTextConfig) => void;
  currentConfig: SpeechToTextConfig | null;
  // Update config props
  updateConfig?: { autoUpdate: boolean; checkInterval: number };
  onUpdateConfigChange?: (config: {
    autoUpdate: boolean;
    checkInterval: number;
  }) => void;
}

export const TranscriptionConfig: React.FC<Props> = ({
  visible,
  onClose,
  onSave,
  currentConfig,
  updateConfig,
  onUpdateConfigChange,
}) => {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [isSaving, setIsSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState<GeminiModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [localUpdateConfig, setLocalUpdateConfig] = useState(
    updateConfig || UpdateManagerService.loadConfig(),
  );

  // Load saved config or set defaults
  useEffect(() => {
    if (visible) {
      const savedConfig = currentConfig || SpeechToTextService.loadConfig();

      // Default values (recommended settings)
      const defaultValues = {
        apiKey: "",
        geminiApiKey: "",
        geminiModel: "models/gemini-flash-latest", // Default model
        languageCode: "vi-VN",
        enableSpeakerDiarization: false,
        enableAutomaticPunctuation: true,
        maxAlternatives: 1,
        minSpeakerCount: 2,
        maxSpeakerCount: 6,
        segmentTimeout: 2000,
        segmentMaxLength: 150,
        timestampDelay: 8,
        maxAudioDurationMinutes: 30,
        maxFileSizeMB: 200,
        requestDelaySeconds: 5,
        summaryPrompt:
          t('config.summaryPromptDefault'),
        availableLanguages: DEFAULT_AVAILABLE_LANGUAGES,
      };

      // Merge saved config with defaults (ensures new fields have default values)
      const mergedConfig = savedConfig
        ? { ...defaultValues, ...savedConfig }
        : defaultValues;
      form.setFieldsValue(mergedConfig);

      // Auto-load models if API key exists
      if (mergedConfig.geminiApiKey) {
        handleLoadModels(mergedConfig.geminiApiKey);
      }
    }
  }, [visible, currentConfig, form]);

  // Function to load available Gemini models
  const handleLoadModels = async (apiKey: string) => {
    if (!apiKey || apiKey.trim().length < 20) {
      return; // Invalid API key
    }

    // Snapshot limit values before loading — must never be reset by API key changes
    const limitSnapshot = {
      maxAudioDurationMinutes: form.getFieldValue("maxAudioDurationMinutes"),
      maxFileSizeMB: form.getFieldValue("maxFileSizeMB"),
      requestDelaySeconds: form.getFieldValue("requestDelaySeconds"),
      summaryPrompt: form.getFieldValue("summaryPrompt"),
    };

    setIsLoadingModels(true);
    try {
      const response = await AIRefinementService.listGeminiModels(apiKey);

      // Filter models that support generateContent
      const supportedModels = response.models
        .filter((model: any) =>
          model.supportedGenerationMethods?.includes("generateContent"),
        )
        .map((model: any) => ({
          name: model.name,
          displayName: model.displayName,
          description: model.description,
          inputTokenLimit: model.inputTokenLimit,
          outputTokenLimit: model.outputTokenLimit,
          supportedGenerationMethods: model.supportedGenerationMethods,
        })) as GeminiModel[];

      setAvailableModels(supportedModels);

      if (supportedModels.length > 0) {
        message.success(
          t('config.modelsFound', { count: supportedModels.length }),
        );

        // Auto-select first model if none selected
        const currentModel = form.getFieldValue("geminiModel");
        if (!currentModel) {
          // Prefer gemini-flash-latest if available
          const preferredModel =
            supportedModels.find((m) => m.name.includes("gemini-flash-latest")) ||
            supportedModels[0];
          form.setFieldValue("geminiModel", preferredModel.name);
        }
      } else {
        message.warning(
          t('config.noModels'),
        );
      }
    } catch (error: any) {
      console.error("Failed to load models:", error);
      message.error(t('config.loadModelsError', { error: error.message }));
      setAvailableModels([]);
    } finally {
      setIsLoadingModels(false);
      // Restore limit values — API key changes must never reset these settings
      const restoredLimits = Object.fromEntries(
        Object.entries(limitSnapshot).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(restoredLimits).length > 0) {
        form.setFieldsValue(restoredLimits);
      }
    }
  };

  // Watch for Gemini API key changes
  const handleGeminiApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const apiKey = e.target.value;
    if (apiKey && apiKey.length >= 20) {
      // Auto-load models when valid API key is entered
      handleLoadModels(apiKey);
    } else {
      setAvailableModels([]);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setIsSaving(true);

      const config: SpeechToTextConfig = {
        apiKey: values.apiKey?.trim() || "",
        geminiApiKey: values.geminiApiKey?.trim() || "",
        geminiModel: values.geminiModel || "models/gemini-flash-latest",
        languageCode: values.languageCode,
        enableSpeakerDiarization: values.enableSpeakerDiarization,
        enableAutomaticPunctuation: values.enableAutomaticPunctuation,
        maxAlternatives: values.maxAlternatives || 1,
        minSpeakerCount: values.minSpeakerCount || 2,
        maxSpeakerCount: values.maxSpeakerCount || 6,
        segmentTimeout: values.segmentTimeout || 2500,
        segmentMaxLength: values.segmentMaxLength || 150,
        timestampDelay: values.timestampDelay || 8,

        // Gemini API Limits
        maxAudioDurationMinutes: values.maxAudioDurationMinutes || 30,
        maxFileSizeMB: values.maxFileSizeMB || 200,
        requestDelaySeconds: values.requestDelaySeconds || 5,
        summaryPrompt:
          values.summaryPrompt ||
          t('config.summaryPromptDefault'),
        availableLanguages: values.availableLanguages ?? DEFAULT_AVAILABLE_LANGUAGES,
      };

      // Validate: Speaker diarization requires API Key
      // if (config.enableSpeakerDiarization && !config.apiKey) {
      //   message.error('⚠️ Nhận diện người nói yêu cầu Google Cloud API Key');
      //   setIsSaving(false);
      //   return;
      // }

      // Save to localStorage
      SpeechToTextService.saveConfig(config);

      // Notify parent
      onSave(config);

      message.success(t('config.saveSuccess'));
      onClose();
    } catch (error) {
      console.error("Validation failed:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearConfig = () => {
    Modal.confirm({
      title: t('config.deleteConfigTitle'),
      content: t('config.deleteConfigContent'),
      okText: t('config.deleteOk'),
      okType: "danger",
      cancelText: t('config.deleteCancel'),
      onOk: () => {
        SpeechToTextService.clearConfig();
        form.resetFields();
        message.info(t('config.clearSuccess'));
      },
    });
  };

  return (
    <Modal
      title={
        <Space>
          <SettingOutlined />
          <span>{t('config.title')}</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      width={700}
      footer={[
        <Button
          key="clear"
          danger
          icon={<DeleteOutlined />}
          onClick={handleClearConfig}
        >
          {t('config.clearConfig')}
        </Button>,
        <Button key="cancel" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button
          key="save"
          type="primary"
          icon={<SaveOutlined />}
          loading={isSaving}
          onClick={handleSave}
        >
          {t('config.saveConfig')}
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" autoComplete="off">
        {/* Gemini API Key */}
        <Form.Item
          label={t('config.apiKeyLabel')}
          name="geminiApiKey"
          rules={[{ min: 20, message: t('config.apiKeyValidation') }]}
          extra={
            <Space direction="vertical" size="small" style={{ marginTop: 8 }}>
              <div style={{ fontSize: "12px", color: "#4f46e5" }}>
                {t('config.apiKeyExtra')}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: "#10b981",
                  fontWeight: "bold",
                }}
              >
                {t('config.apiKeyFreePrefix')}{" "}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google AI Studio
                </a>
              </div>
              <div style={{ fontSize: "12px", color: "#475569" }}></div>
              <div
                style={{
                  fontSize: "11px",
                  color: "#d97706",
                  background: "#fffbeb",
                  border: "1px solid #fcd34d",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  marginTop: "4px",
                }}
              >
                {/* ⚠️ <strong>Hạn mức miễn phí:</strong> 250,000 tokens/ngày • 15 requests/phút<br /> */}
                📊 Monitor usage:{" "}
                <a
                  href="https://ai.dev/rate-limit"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ai.dev/rate-limit
                </a>
              </div>
            </Space>
          }
        >
          <Input.Password
            placeholder={t('config.apiKeyPlaceholder')}
            autoComplete="off"
            onChange={handleGeminiApiKeyChange}
          />
        </Form.Item>

        {/* Gemini Model Selection */}
        {availableModels.length > 0 && (
          <Form.Item
          label={t('config.modelLabel')}
          name="geminiModel"
          rules={[{ required: true, message: t('config.modelValidation') }]}
            extra={
              <Space size="small" style={{ marginTop: 8 }}>
                <div style={{ fontSize: "12px", color: "#475569" }}></div>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={isLoadingModels}
                  onClick={() => {
                    const apiKey = form.getFieldValue("geminiApiKey");
                    handleLoadModels(apiKey);
                  }}
                >
                  {t('config.modelReload')}
                </Button>
              </Space>
            }
          >
            <Select
              placeholder={t('config.modelPlaceholder')}
              loading={isLoadingModels}
              notFoundContent={
                isLoadingModels ? (
                  <Spin size="small" />
                ) : (
                  t('config.modelNotFound')
                )
              }
              showSearch
              optionFilterProp="children"
              optionLabelProp="label"
              listHeight={400}
              dropdownStyle={{ maxHeight: "500px" }}
            >
              {availableModels.map((model) => (
                <Select.Option
                  key={model.name}
                  value={model.name}
                  label={model.displayName}
                  style={{ height: "auto", padding: "8px 12px" }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                    }}
                  >
                    <div style={{ fontWeight: "bold", fontSize: "13px" }}>
                      {model.displayName}
                    </div>
                    {model.description && (
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#475569",
                          lineHeight: "1.4",
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                        }}
                      >
                        {model.description}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: "10px",
                        color: "#4f46e5",
                        marginTop: "2px",
                      }}
                    >
                      {t('config.modelTokens', { input: model.inputTokenLimit.toLocaleString(), output: model.outputTokenLimit.toLocaleString() })}
                    </div>
                  </div>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        )}

        <Form.Item
          label={t('config.languageLabel')}
          name="languageCode"
          rules={[{ required: true, message: t('config.languageValidation') }]}
          extra={t('config.languageExtra')}
        >
          <Select
            showSearch
            placeholder={t('config.languageSearch')}
            filterOption={(input, option) => {
              const lang = WORLD_LANGUAGES.find(l => l.value === option?.value);
              if (!lang) return false;
              const q = input.toLowerCase();
              return lang.name.toLowerCase().includes(q)
                || lang.englishName.toLowerCase().includes(q)
                || lang.keywords.toLowerCase().includes(q)
                || lang.value.toLowerCase().includes(q);
            }}
            labelRender={(opt) => {
              const lang = WORLD_LANGUAGES.find(l => l.value === opt.value);
              return lang ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <span className={`fi fi-${lang.fiCode}`} style={{ fontSize: 15, borderRadius: 2 }} />
                  {lang.name}
                </span>
              ) : <span>{opt.label}</span>;
            }}
            options={WORLD_LANGUAGES.map(l => ({
              value: l.value,
              label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`fi fi-${l.fiCode}`} style={{ fontSize: 16, borderRadius: 2, flexShrink: 0 }} />
                  <span>{l.name}</span>
                  <span style={{ color: '#8c8c8c', fontSize: 12 }}>{l.englishName}</span>
                </span>
              ),
            }))}
          />
        </Form.Item>

        <Form.Item
          label={t('config.availableLangsLabel')}
          name="availableLanguages"
          extra={t('config.availableLangsExtra')}
        >
          <LanguageCheckGrid />
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) =>
            prevValues.enableSpeakerDiarization !==
            currentValues.enableSpeakerDiarization
          }
        >
          {({ getFieldValue }) =>
            getFieldValue("enableSpeakerDiarization") ? (
              <>
                <Form.Item
                  label={t('config.minSpeakersLabel')}
                  name="minSpeakerCount"
                  initialValue={2}
                  extra={t('config.minSpeakersExtra')}
                >
                  <Select placeholder={t('config.minSpeakersLabel')}>
                    <Select.Option value={2}>
                      {t('config.speakers2Rec')}
                    </Select.Option>
                    <Select.Option value={3}>{t('config.speakers3')}</Select.Option>
                    <Select.Option value={4}>{t('config.speakers4')}</Select.Option>
                    <Select.Option value={5}>{t('config.speakers5')}</Select.Option>
                    <Select.Option value={6}>{t('config.speakers6')}</Select.Option>
                  </Select>
                </Form.Item>

                <Form.Item
                  label={t('config.maxSpeakersLabel')}
                  name="maxSpeakerCount"
                  initialValue={6}
                  extra={t('config.maxSpeakersExtra')}
                >
                  <Select placeholder={t('config.maxSpeakersLabel')}>
                    <Select.Option value={2}>{t('config.speakers2')}</Select.Option>
                    <Select.Option value={3}>{t('config.speakers3')}</Select.Option>
                    <Select.Option value={4}>{t('config.speakers4')}</Select.Option>
                    <Select.Option value={5}>{t('config.speakers5')}</Select.Option>
                    <Select.Option value={6}>
                      {t('config.speakers6Rec')}
                    </Select.Option>
                  </Select>
                </Form.Item>
              </>
            ) : null
          }
        </Form.Item>

        <Collapse
          ghost
          items={[
            {
              key: "advanced",
              label: t('config.advancedSettings'),
              forceRender: true,
              children: (
                <>
                  {/* <Form.Item
                  label="Số phiên bản nhận diện"
                  name="maxAlternatives"
                  initialValue={1}
                  extra="Số lượng kết quả thay thế API trả về (1-5). Giá trị cao hơn tốn băng thông hơn."
                >
                  <Select placeholder="Chọn số phiên bản">
                    <Select.Option value={1}>1 (khuyến nghị)</Select.Option>
                    <Select.Option value={2}>2</Select.Option>
                    <Select.Option value={3}>3</Select.Option>
                    <Select.Option value={4}>4</Select.Option>
                    <Select.Option value={5}>5</Select.Option>
                  </Select>
                </Form.Item> */}

                  {/* <Form.Item
                  label="Thời gian chờ kết thúc đoạn (ms)"
                  name="segmentTimeout"
                  initialValue={2000}
                  extra="Thời gian tạm dừng trước khi tự động kết thúc đoạn văn bản. Giá trị cao hơn = câu dài hơn, ít bị cắt ngang (1000-5000ms)"
                >
                  <Select placeholder="Chọn thời gian chờ">
                    <Select.Option value={1000}>1.0s (nhanh, câu ngắn)</Select.Option>
                    <Select.Option value={1500}>1.5s</Select.Option>
                    <Select.Option value={2000}>2.0s(khuyến nghị)</Select.Option>
                    <Select.Option value={2500}>2.5s</Select.Option>
                    <Select.Option value={3000}>3.0s</Select.Option>
                    <Select.Option value={4000}>4.0s</Select.Option>
                    <Select.Option value={5000}>5.0s (chậm, câu rất dài)</Select.Option>
                  </Select>
                </Form.Item> */}

                  <Form.Item
                    label={t('config.timestampDelayLabel')}
                    name="timestampDelay"
                    initialValue={8}
                    extra={t('config.timestampDelayExtra')}
                  >
                    <Select placeholder={t('config.timestampDelayLabel')}>
                      <Select.Option value={0}>{t('config.delay0')}</Select.Option>
                      <Select.Option value={3}>{t('config.delay3')}</Select.Option>
                      <Select.Option value={5}>{t('config.delay5')}</Select.Option>
                      <Select.Option value={8}>{t('config.delay8')}</Select.Option>
                      <Select.Option value={10}>{t('config.delay10')}</Select.Option>
                      <Select.Option value={15}>{t('config.delay15')}</Select.Option>
                      <Select.Option value={20}>{t('config.delay20')}</Select.Option>
                    </Select>
                  </Form.Item>
                  <div
                    style={{
                      marginTop: 24,
                      padding: "14px 16px",
                      background: "#eeecfd",
                      border: "1px solid rgba(80,70,228,.22)",
                      borderRadius: 10,
                    }}
                  >
                    <div
                      style={{
                        marginBottom: 12,
                        fontWeight: 600,
                        color: "#5046e4",
                        fontSize: "14px",
                      }}
                    >
                      {t('config.geminiLimits')}
                    </div>

                    <Form.Item
                      label={t('config.maxDurationLabel')}
                      name="maxAudioDurationMinutes"
                      initialValue={30}
                      extra={t('config.maxDurationExtra')}
                      rules={[
                        { required: true, message: t('config.maxDurationValidation1') },
                        {
                          type: "number",
                          min: 1,
                          max: 999,
                          message: t('config.maxDurationValidation2'),
                        },
                      ]}
                    >
                      <InputNumber
                        placeholder={t('config.maxDurationPlaceholder')}
                        min={1}
                        max={999}
                        style={{ width: "100%" }}
                        addonAfter={t('config.minutesSuffix')}
                      />
                    </Form.Item>

                    <Form.Item
                      label={t('config.maxSizeLabel')}
                      name="maxFileSizeMB"
                      initialValue={200}
                      extra={t('config.maxSizeExtra')}
                      rules={[
                        { required: true, message: t('config.maxSizeValidation1') },
                        {
                          type: "number",
                          min: 1,
                          max: 2000,
                          message: t('config.maxSizeValidation2'),
                        },
                      ]}
                    >
                      <InputNumber
                        placeholder={t('config.maxSizePlaceholder')}
                        min={1}
                        max={2000}
                        style={{ width: "100%" }}
                        addonAfter="MB"
                      />
                    </Form.Item>

                    <Form.Item
                      label={t('config.requestDelayLabel')}
                      name="requestDelaySeconds"
                      initialValue={5}
                      extra={t('config.requestDelayExtra')}
                      rules={[
                        { required: true, message: t('config.requestDelayValidation1') },
                        {
                          type: "number",
                          min: 1,
                          max: 60,
                          message: t('config.requestDelayValidation2'),
                        },
                      ]}
                    >
                      <InputNumber
                        placeholder={t('config.requestDelayPlaceholder')}
                        min={1}
                        max={60}
                        style={{ width: "100%" }}
                        addonAfter={t('config.secondsSuffix')}
                      />
                    </Form.Item>

                    <Form.Item
                      label={t('config.summaryPromptLabel')}
                      name="summaryPrompt"
                      initialValue={t('config.summaryPromptDefault')}
                      extra={t('config.summaryPromptExtra')}
                    >
                      <Input.TextArea
                        placeholder={t('config.summaryPromptPlaceholder')}
                        rows={4}
                        showCount
                        maxLength={1000}
                      />
                    </Form.Item>

                    <div
                      style={{
                        fontSize: "11px",
                        color: "#d97706",
                        background: "#fffbeb",
                        border: "1px solid #fcd34d",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        marginTop: "8px",
                      }}
                    >
                      {t('config.apiLimitNote')}
                      <br />
                      {t('config.freeQuota')}
                    </div>
                  </div>
                </>
              ),
            },
          ]}
        />

        {/* <div
          style={{
            marginTop: 24,
            padding: 16,
            backgroundColor: '#eef2ff',
            borderLeft: '4px solid #4f46e5',
            borderRadius: 8
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: '#4f46e5' }}>🆓 Web Speech API (Miễn phí - Mặc định)</strong>
            <ul style={{ marginBottom: 0, paddingLeft: 20, fontSize: '13px', color: '#1e293b' }}>
              <li>Không cần API Key</li>
              <li>Chạy trên trình duyệt Chrome/Edge</li>
              <li>Miễn phí 100%</li>
              <li><strong>Luôn được dùng</strong> cho ghi âm trực tiếp (live transcription)</li>
              <li><strong style={{ color: '#ef4444' }}>Không</strong> hỗ trợ nhận diện người nói</li>
            </ul>
          </div>
        </div> */}

        {/* App Update Settings */}
        <div
          style={{
            marginTop: 24,
            padding: "14px 16px",
            backgroundColor: "#ecfdf5",
            border: "1px solid #6ee7b7",
            borderRadius: 10,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <strong style={{ color: "#10b981", fontSize: "14px" }}>
              {t('config.autoUpdateTitle')}
            </strong>
            <div style={{ fontSize: "12px", color: "#475569", marginTop: 2 }}>
              {t('config.autoUpdateSubtitle')}
            </div>
          </div>
          <Switch
            checked={localUpdateConfig.autoUpdate}
            onChange={(checked) => {
              const newConfig = { ...localUpdateConfig, autoUpdate: checked };
              setLocalUpdateConfig(newConfig);
              onUpdateConfigChange?.(newConfig);
              UpdateManagerService.saveConfig(newConfig);
              message.success(
                checked
                  ? t('config.autoUpdateEnabled')
                  : t('config.autoUpdateDisabled'),
              );
            }}
          />
        </div>
      </Form>
    </Modal>
  );
};
