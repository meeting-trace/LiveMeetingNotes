import React, { useState } from 'react';
import { Button, Modal, Tabs, Typography, List, Tag, Space, Divider } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { TabsProps } from 'antd';

const { Title, Paragraph, Text } = Typography;

export const HelpButton: React.FC = () => {
  const [modalVisible, setModalVisible] = useState(false);

  const tabItems: TabsProps['items'] = [
    {
      key: '1',
      label: '🎯 Giới thiệu',
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Title level={3}>📝 LiveMeetingNote</Title>
          <Paragraph>
            Ứng dụng web, giúp ghi chép cuộc họp với các khả năng:
          </Paragraph>
          <List
            dataSource={[
              '🎙️ Ghi âm và đánh dấu thời gian tự động khi nhập Ghi chú',
              '🗣️ Chuyển đổi giọng nói sang văn bản: Web Speech API (live, miễn phí) + Gemini AI (file, chất lượng cao)',
              '🤖 Chuẩn hóa văn bản bằng AI với Google Gemini (sửa lỗi, loại từ đệm, thêm dấu câu)',
              '✏️ Chỉnh sửa/Xóa từng đoạn transcription với double-click',
              '⏯️ Seek audio từ timestamp trong transcription',
              '🎬 Chuyển đổi audio sang text bằng Gemini AI (chuột phải vào waveform)',
              '📴 Có khả năng làm việc offline (ghi âm, notes)',
              '💾 Lưu trữ file trực tiếp vào máy tính',
              '🌐 Tương thích đa nền tảng (Chrome, Edge, Firefox, Safari)',
              '🔒 100% bảo mật - Không upload dữ liệu lên server (trừ khi dùng Gemini API)',
              '🔄 Auto-backup & Recovery - Khôi phục khi crash',
              '📂 Load Project - Mở lại project cũ để chỉnh sửa',
              '📄 Export Word - Xuất file .docx để chia sẻ',
              '🔔 Tự động cập nhật - Thông báo khi có phiên bản mới'
            ]}
            renderItem={item => <List.Item>{item}</List.Item>}
          />
        </div>
      ),
    },
    {
      key: '2',
      label: '✨ Tính năng',
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Title level={4}>🎙️ Ghi âm cuộc họp</Title>
              <List size="small">
                <List.Item>• Ghi âm thông qua microphone của thiết bị</List.Item>
                <List.Item>• Hiển thị thời lượng real-time trong khi ghi</List.Item>
                <List.Item>• Hỗ trợ ghi âm dài (không giới hạn thời gian)</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>⏱️ Timestamp tự động</Title>
              <List size="small">
                <List.Item>• Nhấn <Tag color="blue">ENTER</Tag> khi ghi âm → chèn dòng mới → gõ văn bản sẽ tự động chèn nhãn thời gian</List.Item>
                <List.Item>• <strong>Double-click</strong> vào timestamp → jump đến vị trí đó trong audio</List.Item>
                <List.Item>• Timestamp ghi lại chính xác thời điểm trong audio</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>🗣️ Chuyển đổi giọng nói sang văn bản</Title>
              <Paragraph><strong>Có 2 phương thức:</strong></Paragraph>
              
              <Text strong>1. Live transcription (khi đang ghi âm):</Text>
              <List size="small">
                <List.Item>• Sử dụng Web Speech API (miễn phí, không cần API key, độ trễ thấp)</List.Item>
                <List.Item>• Click <Tag color="orange" icon={<span>⚙️</span>}>Cấu hình Speech-to-Text</Tag> → chọn ngôn ngữ</List.Item>
                <List.Item>• Bật <Tag color="cyan">Tự động chuyển giọng nói thành văn bản</Tag> → tự động khi ghi âm</List.Item>
                <List.Item>• Kết quả hiển thị real-time với confidence và timestamp</List.Item>
                <List.Item>• Lưu tự động cả kết quả chính thức và raw data</List.Item>
              </List>
              
              <Text strong style={{ marginTop: '12px', display: 'block' }}>2. File transcription (file audio đã có):</Text>
              <List size="small">
                <List.Item>• Sử dụng Gemini AI (chất lượng cao, tự động phân người nói, thêm dấu câu)</List.Item>
                <List.Item>• Chuột phải vào waveform → "Chuyển đổi giọng nói bằng Gemini AI"</List.Item>
                <List.Item>• Yêu cầu Gemini API Key (miễn phí 250K tokens/ngày)</List.Item>
                <List.Item>• Tự động chia file lớn thành chunks nếu vượt giới hạn (theo cấu hình)</List.Item>
                <List.Item>• Kết quả chất lượng cao hơn Web Speech API</List.Item>
                <List.Item>• ✨ Tùy chỉnh câu lệnh tóm tắt nội dung cuộc họp trong chức năng Cấu hình → Cài đặt nâng cao</List.Item>
              </List>
              
              <Divider style={{ margin: '8px 0' }} />
              
              <Text strong>Thao tác chung:</Text>
              <List size="small">
                <List.Item>• <strong>Double-click timestamp</strong> → seek audio đến vị trí</List.Item>
                <List.Item>• <strong>Double-click nội dung</strong> → chỉnh sửa hoặc xóa đoạn</List.Item>
                <List.Item>• Panel tự động mở rộng khi có kết quả mới</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>🤖 Chuẩn hóa văn bản bằng AI</Title>
              <List size="small">
                <List.Item>• <strong>Mục đích:</strong> Sửa lỗi nhận diện, loại từ đệm (à, ừm...), thêm dấu câu, gộp câu</List.Item>
                <List.Item>• <strong>Yêu cầu:</strong> Gemini API Key (miễn phí 250K tokens/ngày)</List.Item>
                <List.Item>• Click <Tag color="orange" icon={<span>⚙️</span>}>Cấu hình Speech-to-Text</Tag> → nhập Gemini API Key</List.Item>
                <List.Item>• Hệ thống tự động tải danh sách models (gemini-2.5-flash, pro, gemini-2.0-flash...)</List.Item>
                <List.Item>• Chọn model: flash = nhanh + rẻ, pro = chất lượng cao</List.Item>
                <List.Item>• Click <Tag color="purple" icon={<span>✨</span>}>Chuẩn hóa bằng AI</Tag> trong panel Transcription</List.Item>
                <List.Item>• <strong>Checkbox "Sử dụng dữ liệu bổ trợ":</strong> Tick để gửi thêm raw data (tốn x2 tokens)</List.Item>
                <List.Item>• Hệ thống tự động chia batch nhỏ (30 segments) + delay 6s để tránh vượt quota</List.Item>
                <List.Item>• ⚠️ <Text type="danger"><strong>Cảnh báo bảo mật:</strong></Text> Dữ liệu gửi đến Google Gemini API</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>🎵 Audio Playback</Title>
              <List size="small">
                <List.Item>• Hiển thị waveform đồ họa (WaveSurfer.js)</List.Item>
                <List.Item>• Controls: Play/Pause, Skip ±10s, Volume, Zoom In/Zoom Out</List.Item>
                <List.Item>• <strong>Double-click waveform</strong> → seek đến vị trí</List.Item>
                <List.Item>• <strong>Chuột phải → 2 options:</strong></List.Item>
                <List.Item style={{ paddingLeft: '32px' }}>  - "Chèn timestamp" → thêm dấu thời gian vào Notes</List.Item>
                <List.Item style={{ paddingLeft: '32px' }}>  - "Chuyển đổi giọng nói bằng Gemini AI" → transcribe toàn bộ audio</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>💾 Lưu trữ file tự động</Title>
              <Paragraph>
                <strong>Chrome/Edge:</strong> Chọn folder một lần → files lưu trực tiếp vào folder
              </Paragraph>
              <Paragraph>
                <strong>Safari/Firefox:</strong> Files download vào thư mục Downloads
              </Paragraph>
              <Paragraph><strong>Files output:</strong></Paragraph>
              <List size="small">
                <List.Item>📄 <Text code>[ProjectName].webm</Text> - Audio file</List.Item>
                <List.Item>📄 <Text code>[ProjectName]_meeting_info.json</Text> - Meeting metadata</List.Item>
                <List.Item>📄 <Text code>[ProjectName]_metadata.json</Text> - Notes + timestamps</List.Item>
                <List.Item>📄 <Text code>[ProjectName]_transcription.json</Text> - Speech-to-Text results (sau khi edit/AI)</List.Item>
                <List.Item>📄 <Text code>[ProjectName]_rawTranscripts.json</Text> - Raw Speech-to-Text data (bổ trợ AI)</List.Item>
                <List.Item>📄 <Text code>[ProjectName].docx</Text> - Word document</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>🔄 Auto-backup & Recovery</Title>
              <List size="small">
                <List.Item>• Tự động backup mỗi 3 giây (localStorage + IndexedDB)</List.Item>
                <List.Item>• Refresh page/đóng browser đột ngột → dialog khôi phục</List.Item>
                <List.Item>• Backup tự xóa sau khi save thành công (hoặc người dùng quyết định hủy bỏ việc lưu)</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>🔔 Tự động cập nhật ứng dụng</Title>
              <List size="small">
                <List.Item>• Tự động kiểm tra phiên bản mới khi mở ứng dụng</List.Item>
                <List.Item>• Hiển thị thông báo khi có bản cập nhật</List.Item>
                <List.Item>• Tùy chọn "Cập nhật ngay" hoặc "Để sau"</List.Item>
                <List.Item>• Nếu chọn "Để sau" → reload trang sẽ thông báo lại</List.Item>
                <List.Item>• Cài đặt: Click <Tag color="orange">⚙️Cấu hình</Tag> → bật/tắt tự động cập nhật</List.Item>
              </List>
            </div>
          </Space>
        </div>
      ),
    },
    {
      key: '3',
      label: '🎮 Hướng dẫn',
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Title level={4}>Scenario 1: Ghi âm cuộc họp mới với Speech-to-Text</Title>
              <List>
                <List.Item>1. Click <Tag color="blue">Chọn thư mục</Tag> → chọn thư mục lưu file (Chrome/Edge)</List.Item>
                <List.Item>2. Điền thông tin cuộc họp</List.Item>
                <List.Item>3. <strong>(TÙY CHỌN)</strong> Cấu hình: 
                  <List size="small" style={{marginTop: 8}}>
                    <List.Item>• Click <Tag color="orange">⚙️Cấu hình</Tag> (góc phải dòng 1)</List.Item>
                    <List.Item>• Chọn ngôn ngữ cho Web Speech API</List.Item>
                    <List.Item>• Nhập Gemini API Key (nếu dùng Gemini transcription hoặc AI refinement)</List.Item>
                    <List.Item>• Chọn Gemini Model (khuyên dùng: gemini-2.5-flash)</List.Item>
                    <List.Item>• Cấu hình giới hạn: thời lượng (60 phút), file size (20 MB), delay (5 giây)</List.Item>
                    <List.Item>• Bật/tắt tự động cập nhật ứng dụng</List.Item>
                  </List>
                </List.Item>
                <List.Item>4. Bật <Tag color="cyan">Tự động chuyển giọng nói thành văn bản</Tag> (dòng 2) + Chọn ngôn ngữ</List.Item>
                <List.Item>5. Click <Tag color="red">Ghi âm</Tag> → bắt đầu ghi âm</List.Item>
                <List.Item>6. Gõ notes hoặc để Web Speech API tự động ghi nhận</List.Item>
                <List.Item>7. <strong>(TÙY CHỌN)</strong> Xử lý transcription:
                  <List size="small" style={{marginTop: 8}}>
                    <List.Item>• <strong>Double-click</strong> để chỉnh sửa/xóa đoạn</List.Item>
                    <List.Item>• Click <Tag color="purple">✨ Chuẩn hóa bằng AI</Tag> → chọn có dùng raw data hay không</List.Item>
                  </List>
                </List.Item>
                <List.Item>8. Click <Tag>Dừng</Tag> → files tự động lưu</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>Scenario 2: Chỉ ghi chép không ghi âm</Title>
              <List>
                <List.Item>1. Click <Tag color="blue">Chọn thư mục</Tag> (tùy chọn)</List.Item>
                <List.Item>2. Điền thông tin cuộc họp</List.Item>
                <List.Item>3. Gõ notes (không nhấn Ghi âm)</List.Item>
                <List.Item>4. Click <Tag color="green">Lưu ghi chú</Tag> → lưu JSON + DOCX</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>Scenario 3: Tải dự án đã lưu để chỉnh sửa</Title>
              <List>
                <List.Item>1. Click <Tag color="purple">Tải dự án đã lưu</Tag> → chọn thư mục dự án cũ</List.Item>
                <List.Item>2. Dữ liệu tự động load lên giao diện</List.Item>
                <List.Item>3. Chỉnh sửa ghi chú/thông tin cuộc họp</List.Item>
                <List.Item>4. Click <Tag color="green">Lưu thay đổi</Tag> → tạo version mới</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>✨Scenario 4: Chuyển đổi file audio sang text với Gemini AI</Title>
              <List>
                <List.Item>1. Tải project hoặc ghi âm mới</List.Item>
                <List.Item>2. Đảm bảo đã cấu hình Gemini API Key</List.Item>
                <List.Item>3. Chuột phải vào waveform → "Chuyển đổi giọng nói bằng Gemini AI"</List.Item>
                <List.Item>4. Xác nhận thông tin (model, file size, duration)</List.Item>
                <List.Item>5. Nếu file quá lớn → chọn:</List.Item>
                <List.Item style={{ paddingLeft: '32px' }}>  • "Chuyển đổi toàn bộ file (Tự động)" → hệ thống auto-split</List.Item>
                <List.Item style={{ paddingLeft: '32px' }}>  • "Chọn đoạn thủ công" → transcribe một phần</List.Item>
                <List.Item>6. Đợi xử lý → kết quả hiển thị trong panel Transcription</List.Item>
              </List>
            </div>

    <Title level={4}>-------------------------------------------------------</Title>
            <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Title level={4}>Phím tắt</Title>
          <List>
            <List.Item>
              <Tag color="blue">Enter</Tag> - Chèn nhãn thời gian (khi đang ghi âm)
            </List.Item>
            <List.Item>
              <Tag>Space</Tag> - Phát/Tạm dừng audio (khi focus player)
            </List.Item>
          </List>

          <Divider />

          <Title level={4}>Thao tác chuột trên waveform</Title>
          <List>
            <List.Item>
              <strong>Click đúp chuột vào nhãn thời gian</strong> → Tua đến vị trí tương ứng
            </List.Item>
            <List.Item>
              <strong>Click đúp chuột vào waveform</strong> → Tua đến vị trí tương ứng
            </List.Item>
            <List.Item>
              <strong>Click phải chuột vào waveform</strong> → Menu với 2 options:
            </List.Item>
            <List.Item style={{ paddingLeft: '32px' }}>
              • <strong>"Chèn timestamp"</strong> → Thêm dấu thời gian vào Notes tại vị trí playback
            </List.Item>
            <List.Item style={{ paddingLeft: '32px' }}>
              • <strong>"Chuyển đổi giọng nói bằng Gemini AI"</strong> → Transcribe toàn bộ audio file và tóm tắt nội dung
            </List.Item>
          </List>
        </div>
          </Space>
        </div>
      ),
    },
    {
      key: '4',
      label: '🌐 Tương thích',
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Title level={4}>Trình duyệt được hỗ trợ</Title>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #434343' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>Tính năng</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Chrome</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Safari</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Firefox</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #434343' }}>
                <td style={{ padding: '8px' }}>Ghi âm cuộc họp</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅ (14.1+)</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #434343' }}>
                <td style={{ padding: '8px' }}>Nhận diện giọng nói (khi đang ghi âm)</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>⚠️ không ổn định</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>⚠️ không ổn định</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #434343' }}>
                <td style={{ padding: '8px' }}>Truy cập Hệ thống Thư mục</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅ Lưu trực tiếp</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>⚠️ Tải xuống</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>⚠️ Tải xuống</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #434343' }}>
                <td style={{ padding: '8px' }}>Cài đặt PWA</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #434343' }}>
                <td style={{ padding: '8px' }}>Chế độ Offline</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
              </tr>
            </tbody>
          </table>
          <Paragraph style={{ marginTop: 16 }}>
            <Text strong>Khuyến nghị:</Text> Chrome để có trải nghiệm tốt nhất.
          </Paragraph>
        </div>
      ),
    },
    {
      key: '5',
      label: '🔒 Privacy',
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Title level={4}>Privacy & Security</Title>
          <List>
            <List.Item>
              <Tag color="green">✅</Tag> <strong>100% Client-side</strong> - Không upload dữ liệu lên server
            </List.Item>
            <List.Item>
              <Tag color="green">✅</Tag> <strong>Không cần đăng nhập</strong> - Không thu thập thông tin cá nhân
            </List.Item>
            <List.Item>
              <Tag color="green">✅</Tag> <strong>Local storage only</strong> - Files lưu trên máy người dùng
            </List.Item>
            <List.Item>
              <Tag color="green">✅</Tag> <strong>No analytics</strong> - Không tracking hành vi
            </List.Item>
          </List>

          <Divider />

          <Title level={4}>Use Cases</Title>
          <List>
            <List.Item>✅ Cuộc họp nội bộ - Ghi âm và đánh dấu quyết định quan trọng</List.Item>
            <List.Item>✅ Training/Workshop - Ghi âm bài giảng, note key points</List.Item>
            <List.Item>✅ Họp khách hàng - Lưu trữ yêu cầu làm tài liệu</List.Item>
            <List.Item>✅ Remote teams - Chia sẻ notes + audio cho nhóm làm việc</List.Item>
            <List.Item>✅ Giáo dục/E-learning - Ghi âm và ghi chép bài học</List.Item>
          </List>
        </div>
      ),
    },
    {
      key: '6',
      label: '🙋 Tác giả 🙋',
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Paragraph>
            Xin chào! Mình là <Text strong>NguyenDacHung</Text>, tác giả của ứng dụng này.<br />
            <br />
            <Text>
            <Text strong style={{ fontSize: 16 }}>
              LiveMeetingNotes
            </Text>{" "}
            được phát triển nhằm cung cấp miễn phí một công cụ hỗ trợ ghi chép, lưu trữ và quản lý nội dung cuộc họp một cách{" "}
            <Text strong>chuyên nghiệp</Text>,{" "}
            <Text strong>bảo mật</Text> và{" "}
            <Text strong>tiện lợi</Text>.
            <br />
            <br />

            Ứng dụng được cung cấp{" "}
            <Text strong style={{ color: "#1677ff" }}>
              HOÀN TOÀN MIỄN PHÍ
            </Text>{" "}
            và{" "}
            <Text strong>không vì mục đích thương mại</Text>.
            <br />
            <br />

            Trong trường hợp Anh/Chị thấy LiveMeetingNotes hữu ích, Anh/Chị có thể{" "}
            <Text strong>dành một khoản đóng góp</Text> (tùy tâm) chuyển trực tiếp đến số tài khoản của{" "}
            <Text strong style={{ color: "#16ff48" }}>
              Quỹ bảo trợ trẻ em Việt Nam
            </Text>{" "}
            <br />
            Nội dung chuyển khoản:{" "}
            <Text code>
              LiveMeetingNotes chung tay cùng trẻ em Việt Nam
            </Text>
            <br />
            <br />

            <Text strong type="danger">
              XIN LƯU Ý:
            </Text>
            <br />
            <Text strong>
              Việc quyên góp hoàn toàn tự nguyện, không bắt buộc và không ảnh hưởng đến bất kỳ tính năng nào của ứng dụng.
            </Text>
            <br />
            Tác giả{" "}
            <Text strong>không thu bất kỳ khoản phí sử dụng nào</Text> dưới mọi hình thức!
            <br />
            Mọi hành vi{" "}
            <Text strong type="danger">
              thu phí bắt buộc hoặc mạo danh LiveMeetingNotes
            </Text>{" "}
            đều không xuất phát từ tác giả. Đề nghị người dùng cẩn trọng để tránh các trường hợp lừa đảo.
            <br />
          </Text>
          </Paragraph>
          <List
            size="small"
            header={<Text strong>Thông tin số tài khoản của Quỹ bảo trợ trẻ em Việt Nam</Text>}
            dataSource={[
              <>
                <Text strong>💸🏦 Vietcombank - Quỹ bảo trợ trẻ em Việt Nam:</Text> <br />
                <Text strong></Text> <Text copyable>0010000000355</Text>
              </>,
              <>
                <Text type="secondary" italic>
                  Xin cảm ơn mọi sự ủng hộ! Chúc Anh/Chị sử dụng hiệu quả và lan tỏa giá trị tích cực đến cộng đồng ❤️
                </Text>
              </>
            ]}
            renderItem={item => <List.Item>{item}</List.Item>}
          />
          <Text strong>Mọi thắc mắc hoặc cần hỗ trợ:</Text> vui lòng liên hệ qua các kênh sau
          <List
            size="small"
            header={<Text strong>Thông tin liên hệ</Text>}
            dataSource={[
              <>
                <Text strong>✌️Facebook:</Text>{' '}
                <a href="https://facebook.com/dachungbka" target="_blank" rel="noopener noreferrer">
                  https://facebook.com/dachungbka
                </a>
              </>,
              <>
                <Text strong>🌀Telegram:</Text>{' '}
                <a href="https://t.me/hungnd99" target="_blank" rel="noopener noreferrer">
                  https://t.me/hungnd99
                </a>
              </>,
              <>
                <Text strong>📬Email:</Text> <a href="mailto:dachungbk@gmail.com">dachungbk@gmail.com</a>
              </>
            ]}
            renderItem={item => <List.Item>{item}</List.Item>}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <Button
        type="primary"
        icon={<QuestionCircleOutlined />}
        onClick={() => setModalVisible(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        Giới thiệu & Hướng dẫn
      </Button>

      <Modal
        title="📚 Ứng dụng LiveMeetingNotes"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={800}
        centered
      >
        <Tabs defaultActiveKey="" items={tabItems} />
      </Modal>
    </>
  );
};
