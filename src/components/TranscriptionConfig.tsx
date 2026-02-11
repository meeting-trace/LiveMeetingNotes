import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, InputNumber, Select, Button, Space, App, Collapse, Spin, Switch } from 'antd';
import { SettingOutlined, SaveOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import type { SpeechToTextConfig, GeminiModel } from '../types/types';
import { SpeechToTextService } from '../services/speechToText';
import { AIRefinementService } from '../services/aiRefinement';
import { UpdateManagerService } from '../services/updateManager';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (config: SpeechToTextConfig) => void;
  currentConfig: SpeechToTextConfig | null;
  // Update config props
  updateConfig?: { autoUpdate: boolean; checkInterval: number };
  onUpdateConfigChange?: (config: { autoUpdate: boolean; checkInterval: number }) => void;
}

export const TranscriptionConfig: React.FC<Props> = ({
  visible,
  onClose,
  onSave,
  currentConfig,
  updateConfig,
  onUpdateConfigChange
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [isSaving, setIsSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState<GeminiModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [localUpdateConfig, setLocalUpdateConfig] = useState(
    updateConfig || UpdateManagerService.loadConfig()
  );

  // Load saved config or set defaults
  useEffect(() => {
    if (visible) {
      const savedConfig = currentConfig || SpeechToTextService.loadConfig();
      
      // Default values (recommended settings)
      const defaultValues = {
        apiKey: '',
        geminiApiKey: '',
        geminiModel: 'models/gemini-2.5-flash', // Default model
        languageCode: 'vi-VN',
        enableSpeakerDiarization: false,
        enableAutomaticPunctuation: true,
        maxAlternatives: 1,
        minSpeakerCount: 2,
        maxSpeakerCount: 6,
        segmentTimeout: 2000,
        segmentMaxLength: 150,
        timestampDelay: 8,
        maxAudioDurationMinutes: 60,
        maxFileSizeMB: 20,
        requestDelaySeconds: 5,
        summaryPrompt: 'Tóm tắt cụ thể các nội dung chính của từng người phát biểu, được thảo luận trong cuộc họp, tổng hợp theo trình tự thời gian. Bao gồm nhưng không giới hạn các chủ đề chính, quyết định quan trọng, và kết luận (nếu có).'
      };
      
      // Merge saved config with defaults (ensures new fields have default values)
      const mergedConfig = savedConfig ? { ...defaultValues, ...savedConfig } : defaultValues;
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

    setIsLoadingModels(true);
    try {
      const response = await AIRefinementService.listGeminiModels(apiKey);
      
      // Filter models that support generateContent
      const supportedModels = response.models
        .filter((model: any) => 
          model.supportedGenerationMethods?.includes('generateContent')
        )
        .map((model: any) => ({
          name: model.name,
          displayName: model.displayName,
          description: model.description,
          inputTokenLimit: model.inputTokenLimit,
          outputTokenLimit: model.outputTokenLimit,
          supportedGenerationMethods: model.supportedGenerationMethods
        })) as GeminiModel[];

      setAvailableModels(supportedModels);
      
      if (supportedModels.length > 0) {
        message.success(`✅ Tìm thấy ${supportedModels.length} Gemini models khả dụng`);
        
        // Auto-select first model if none selected
        const currentModel = form.getFieldValue('geminiModel');
        if (!currentModel) {
          // Prefer gemini-2.5-flash if available
          const preferredModel = supportedModels.find(m => m.name.includes('gemini-2.5-flash')) || supportedModels[0];
          form.setFieldValue('geminiModel', preferredModel.name);
        }
      } else {
        message.warning('⚠️ Không tìm thấy Gemini model nào hỗ trợ generateContent');
      }
    } catch (error: any) {
      console.error('Failed to load models:', error);
      message.error(`❌ Không thể tải danh sách models: ${error.message}`);
      setAvailableModels([]);
    } finally {
      setIsLoadingModels(false);
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
        apiKey: values.apiKey?.trim() || '',
        geminiApiKey: values.geminiApiKey?.trim() || '',
        geminiModel: values.geminiModel || 'models/gemini-2.5-flash',
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
        maxAudioDurationMinutes: values.maxAudioDurationMinutes || 60,
        maxFileSizeMB: values.maxFileSizeMB || 150,
        requestDelaySeconds: values.requestDelaySeconds || 5,
        summaryPrompt: values.summaryPrompt || 'Tóm tắt cụ thể các nội dung chính của từng người phát biểu, được thảo luận trong cuộc họp, tổng hợp theo trình tự thời gian. Bao gồm nhưng không giới hạn các chủ đề chính, quyết định quan trọng, và kết luận (nếu có).'
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

      message.success('✅ Cấu hình đã được lưu thành công');
      onClose();
    } catch (error) {
      console.error('Validation failed:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearConfig = () => {
    Modal.confirm({
      title: 'Xóa cấu hình?',
      content: 'Bạn có chắc chắn muốn xóa cấu hình?',
      okText: 'Xóa',
      okType: 'danger',
      cancelText: 'Hủy',
      onOk: () => {
        SpeechToTextService.clearConfig();
        form.resetFields();
        message.info('🗑️ Đã xóa cấu hình');
      }
    });
  };

  return (
    <Modal
      title={
        <Space>
          <SettingOutlined />
          <span>Cấu hình</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      width={700}
      footer={[
        <Button key="clear" danger icon={<DeleteOutlined />} onClick={handleClearConfig}>
          Xóa cấu hình
        </Button>,
        <Button key="cancel" onClick={onClose}>
          Hủy
        </Button>,
        <Button
          key="save"
          type="primary"
          icon={<SaveOutlined />}
          loading={isSaving}
          onClick={handleSave}
        >
          Lưu cấu hình
        </Button>
      ]}
    >
      <Form
        form={form}
        layout="vertical"
        autoComplete="off"
      >
        {/* Gemini API Key */}
        <Form.Item
          label="Gemini API Key"
          name="geminiApiKey"
          rules={[
            { min: 20, message: 'API Key phải có ít nhất 20 ký tự' }
          ]}
          extra={
            <Space direction="vertical" size="small" style={{ marginTop: 8 }}>
              <div style={{ fontSize: '12px', color: '#667eea' }}>
                🤖 <strong>Cho tính năng *Chuẩn hóa bằng AI* và *Chuyển đổi giọng nói bằng Gemini AI*:</strong>
              </div>
              <div style={{ fontSize: '12px', color: '#52c41a', fontWeight: 'bold' }}>
                ✨ MIỄN PHÍ: Lấy tại{' '}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google AI Studio
                </a>
              </div>
              <div style={{ fontSize: '12px', color: '#888' }}>
                💡 Nhập API Key → Hệ thống tự động tải danh sách models
              </div>
              <div style={{ 
                fontSize: '11px', 
                color: '#fa8c16',
                background: '#fff7e6',
                padding: '8px',
                borderRadius: '4px',
                marginTop: '4px'
              }}>
                ⚠️ <strong>Hạn mức miễn phí:</strong> 250,000 tokens/ngày • 15 requests/phút<br />
                📊 Monitor usage: <a href="https://ai.dev/rate-limit" target="_blank" rel="noopener noreferrer">ai.dev/rate-limit</a>
              </div>
            </Space>
          }
        >
          <Input.Password
            placeholder="Lấy miễn phí tại aistudio.google.com/app/apikey"
            autoComplete="off"
            onChange={handleGeminiApiKeyChange}
          />
        </Form.Item>

        {/* Gemini Model Selection */}
        {availableModels.length > 0 && (
          <Form.Item
            label="Gemini Model (lưu ý: một số mô hình Gemini phải trả phí mới dùng được)"
            name="geminiModel"
            rules={[{ required: true, message: 'Vui lòng chọn model' }]}
            extra={
              <Space size="small" style={{ marginTop: 8 }}>
                <div style={{ fontSize: '12px', color: '#888' }}>
                  🤖 Model AI để chuẩn hóa văn bản
                </div>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={isLoadingModels}
                  onClick={() => {
                    const apiKey = form.getFieldValue('geminiApiKey');
                    handleLoadModels(apiKey);
                  }}
                >
                  Tải lại
                </Button>
              </Space>
            }
          >
            <Select
              placeholder="Chọn Gemini model..."
              loading={isLoadingModels}
              notFoundContent={isLoadingModels ? <Spin size="small" /> : 'Không có model khả dụng'}
              showSearch
              optionFilterProp="children"
              optionLabelProp="label"
              listHeight={400}
              dropdownStyle={{ maxHeight: '500px' }}
            >
              {availableModels.map(model => (
                <Select.Option 
                  key={model.name} 
                  value={model.name}
                  label={model.displayName}
                  style={{ height: 'auto', padding: '8px 12px' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '13px' }}>
                      {model.displayName}
                    </div>
                    {model.description && (
                      <div style={{ 
                        fontSize: '11px', 
                        color: '#666', 
                        lineHeight: '1.4',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word'
                      }}>
                        {model.description}
                      </div>
                    )}
                    <div style={{ fontSize: '10px', color: '#1890ff', marginTop: '2px' }}>
                      📥 Input: {model.inputTokenLimit.toLocaleString()} | 📤 Output: {model.outputTokenLimit.toLocaleString()} tokens
                    </div>
                  </div>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        )}

        <Form.Item
          label="Ngôn ngữ"
          name="languageCode"
          rules={[{ required: true, message: 'Vui lòng chọn ngôn ngữ' }]}
          extra="Ngôn ngữ sử dụng cho nhận dạng giọng nói"
        >
          <Select>
            <Select.Option value="vi-VN">🇻🇳 Tiếng Việt (Vietnam)</Select.Option>
            <Select.Option value="en-US">🇺🇸 English (US)</Select.Option>
            <Select.Option value="en-GB">🇬🇧 English (UK)</Select.Option>
            <Select.Option value="ja-JP">🇯🇵 日本語 (Japanese)</Select.Option>
            <Select.Option value="ko-KR">🇰🇷 한국어 (Korean)</Select.Option>
            <Select.Option value="zh-CN">🇨🇳 中文 (Chinese Simplified)</Select.Option>
            <Select.Option value="zh-TW">🇹🇼 中文 (Chinese Traditional)</Select.Option>
            <Select.Option value="fr-FR">🇫🇷 Français (French)</Select.Option>
            <Select.Option value="de-DE">🇩🇪 Deutsch (German)</Select.Option>
            <Select.Option value="es-ES">🇪🇸 Español (Spanish)</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) => 
            prevValues.enableSpeakerDiarization !== currentValues.enableSpeakerDiarization
          }
        >
          {({ getFieldValue }) => 
            getFieldValue('enableSpeakerDiarization') ? (
              <>
                <Form.Item
                  label="Số người nói tối thiểu"
                  name="minSpeakerCount"
                  initialValue={2}
                  extra="Số lượng người nói dự kiến tối thiểu (2-6)"
                >
                  <Select placeholder="Chọn số người tối thiểu">
                    <Select.Option value={2}>2 người (khuyến nghị)</Select.Option>
                    <Select.Option value={3}>3 người</Select.Option>
                    <Select.Option value={4}>4 người</Select.Option>
                    <Select.Option value={5}>5 người</Select.Option>
                    <Select.Option value={6}>6 người</Select.Option>
                  </Select>
                </Form.Item>

                <Form.Item
                  label="Số người nói tối đa"
                  name="maxSpeakerCount"
                  initialValue={6}
                  extra="Số lượng người nói dự kiến tối đa (2-6)"
                >
                  <Select placeholder="Chọn số người tối đa">
                    <Select.Option value={2}>2 người</Select.Option>
                    <Select.Option value={3}>3 người</Select.Option>
                    <Select.Option value={4}>4 người</Select.Option>
                    <Select.Option value={5}>5 người</Select.Option>
                    <Select.Option value={6}>6 người (khuyến nghị)</Select.Option>
                  </Select>
                </Form.Item>
              </>
            ) : null
          }
        </Form.Item>

        <Collapse 
          ghost
          items={[{
            key: 'advanced',
            label: '⚙️ Cài đặt nâng cao',
            children: (
              <>
                <Form.Item
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
                </Form.Item>

                <Form.Item
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
                </Form.Item>

                <Form.Item
                  label="Độ trễ timestamp khi gõ notes (giây)"
                  name="timestampDelay"
                  initialValue={8}
                  extra="Khi gõ notes thủ công, timestamp sẽ lùi lại X giây để bù thời gian phản ứng (0-60 giây)"
                >
                  <Select placeholder="Chọn độ trễ">
                    <Select.Option value={0}>0s (không trễ)</Select.Option>
                    <Select.Option value={3}>3s</Select.Option>
                    <Select.Option value={5}>5s</Select.Option>
                    <Select.Option value={8}>8s (khuyến nghị)</Select.Option>
                    <Select.Option value={10}>10s</Select.Option>
                    <Select.Option value={15}>15s</Select.Option>
                    <Select.Option value={20}>20s</Select.Option>
                  </Select>
                </Form.Item>
                <div style={{ 
                  marginTop: 24, 
                  padding: 16, 
                  background: 'linear-gradient(135deg, #667eea11 0%, #764ba211 100%)',
                  border: '2px solid #667eea',
                  borderRadius: 8 
                }}>
                  <div style={{ marginBottom: 12, fontWeight: 'bold', color: '#667eea', fontSize: '14px' }}>
                    🎯 Giới hạn Gemini API
                  </div>

                  <Form.Item
                    label="Thời lượng audio tối đa (phút)"
                    name="maxAudioDurationMinutes"
                    initialValue={60}
                    extra="Thời lượng tối đa của file audio để xử lý (mặc định: 60 phút)"
                    rules={[
                      { required: true, message: 'Vui lòng nhập thời lượng' },
                      { type: 'number', min: 1, max: 999, message: 'Vui lòng nhập từ 1-999 phút' }
                    ]}
                  >
                    <InputNumber
                      placeholder="Nhập thời lượng (phút)"
                      min={1}
                      max={999}
                      style={{ width: '100%' }}
                      addonAfter="phút"
                    />
                  </Form.Item>

                  <Form.Item
                    label="Kích thước file tối đa (MB)"
                    name="maxFileSizeMB"
                    initialValue={150}
                    extra="Kích thước tối đa của mỗi file gửi lên Gemini API"
                    rules={[
                      { required: true, message: 'Vui lòng nhập kích thước' },
                      { type: 'number', min: 1, max: 2000, message: 'Vui lòng nhập từ 1-2000 MB' }
                    ]}
                  >
                    <InputNumber
                      placeholder="Nhập kích thước (MB)"
                      min={1}
                      max={2000}
                      style={{ width: '100%' }}
                      addonAfter="MB"
                    />
                  </Form.Item>

                  <Form.Item
                    label="Delay giữa các request (giây)"
                    name="requestDelaySeconds"
                    initialValue={5}
                    extra="Thời gian chờ giữa 2 lần gửi request để tuân thủ rate limit (mặc định: 5s)"
                    rules={[
                      { required: true, message: 'Vui lòng nhập delay' },
                      { type: 'number', min: 1, max: 60, message: 'Vui lòng nhập từ 1-60 giây' }
                    ]}
                  >
                    <InputNumber
                      placeholder="Nhập delay (giây)"
                      min={1}
                      max={60}
                      style={{ width: '100%' }}
                      addonAfter="giây"
                    />
                  </Form.Item>

                  <Form.Item
                    label="Prompt tóm tắt"
                    name="summaryPrompt"
                    initialValue="Tóm tắt cụ thể các nội dung chính của từng người phát biểu, được thảo luận trong cuộc họp, tổng hợp theo trình tự thời gian. Bao gồm nhưng không giới hạn các chủ đề chính, quyết định quan trọng, và kết luận (nếu có)."
                    extra="Prompt tuỳ chỉnh để yêu cầu Gemini tóm tắt nội dung cuộc họp theo ý bạn"
                  >
                    <Input.TextArea
                      placeholder="Nhập prompt tuỳ chỉnh cho tóm tắt..."
                      rows={4}
                      showCount
                      maxLength={1000}
                    />
                  </Form.Item>

                  <div style={{ 
                    fontSize: '11px', 
                    color: '#fa8c16',
                    background: '#fff7e6',
                    padding: '8px',
                    borderRadius: '4px',
                    marginTop: '8px'
                  }}>
                    ⚠️ <strong>Lưu ý:</strong> Giới hạn này áp dụng cho tính năng "Chuyển đổi giọng nói bằng Gemini AI"<br />
                    📊 Free tier: 15 requests/phút, 1500 requests/ngày
                  </div>
                </div>
              </>
            )
          }]}
        />

        <div
          style={{
            marginTop: 24,
            padding: 16,
            backgroundColor: '#19041b',
            borderLeft: '4px solid #1890ff',
            borderRadius: 4
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: '#52c41a' }}>🆓 Web Speech API (Miễn phí - Mặc định)</strong>
            <ul style={{ marginBottom: 0, paddingLeft: 20, fontSize: '13px' }}>
              <li>Không cần API Key</li>
              <li>Chạy trên trình duyệt Chrome/Edge</li>
              <li>Miễn phí 100%</li>
              <li><strong>Luôn được dùng</strong> cho ghi âm trực tiếp (live transcription)</li>
              <li><strong style={{ color: '#ff4d4f' }}>Không</strong> hỗ trợ nhận diện người nói</li>
            </ul>
          </div>
        </div>

        {/* App Update Settings */}
        <div
          style={{
            marginTop: 24,
            padding: 12,
            backgroundColor: '#f6ffed',
            border: '1px solid #b7eb8f',
            borderRadius: 4,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div>
            <strong style={{ color: '#52c41a', fontSize: '14px' }}>🔄 Tự động cập nhật</strong>
            <div style={{ fontSize: '12px', color: '#666', marginTop: 2 }}>
              Kiểm tra khi mở ứng dụng
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
                  ? '✅ Đã bật tự động cập nhật' 
                  : '⚠️ Đã tắt tự động cập nhật'
              );
            }}
          />
        </div>
      </Form>
    </Modal>
  );
};
