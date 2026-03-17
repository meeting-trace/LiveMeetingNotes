import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Tabs, Typography, List, Tag, Space, Divider } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { TabsProps } from 'antd';

const { Title, Paragraph, Text } = Typography;

export const HelpButton: React.FC = () => {
  const [modalVisible, setModalVisible] = useState(false);
  const { t } = useTranslation();

  const tabItems: TabsProps['items'] = [
    {
      key: '1',
      label: t('help.tabIntro'),
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Title level={3}>{t('help.introHeading')}</Title>
          <Paragraph>
            {t('help.introDesc')}
          </Paragraph>
          <List
            dataSource={[
              t('help.feature1'),
              t('help.feature2'),
              t('help.feature3'),
              t('help.feature4'),
              t('help.feature5'),
              t('help.feature6'),
              t('help.feature7'),
              t('help.feature8'),
              t('help.feature9'),
              t('help.feature10'),
              t('help.feature11'),
              t('help.feature12'),
              t('help.feature13'),
              t('help.feature14'),
            ]}
            renderItem={item => <List.Item>{item}</List.Item>}
          />
        </div>
      ),
    },
    {
      key: '2',
      label: t('help.tabFeatures'),
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Title level={4}>{t('help.featRecordTitle')}</Title>
              <List size="small">
                <List.Item>{t('help.featRecord1')}</List.Item>
                <List.Item>{t('help.featRecord2')}</List.Item>
                <List.Item>{t('help.featRecord3')}</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>{t('help.featTimestampTitle')}</Title>
              <List size="small">
                <List.Item>{t('help.featTimestamp1Pre')} <Tag color="blue">ENTER</Tag> {t('help.featTimestamp1Post')}</List.Item>
                <List.Item>• <strong>{t('help.featTimestamp2Bold')}</strong> {t('help.featTimestamp2Post')}</List.Item>
                <List.Item>{t('help.featTimestamp3')}</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>{t('help.featSTTTitle')}</Title>
              <Paragraph><strong>{t('help.featSTTModes')}</strong></Paragraph>

              <Text strong>{t('help.featSTTLiveHeader')}</Text>
              <List size="small">
                <List.Item>{t('help.featSTTLive1')}</List.Item>
                <List.Item>{t('help.featSTTLive2Pre')} <Tag color="orange" icon={<span>⚙️</span>}>{t('recording.configure')}</Tag> {t('help.featSTTLive2Post')}</List.Item>
                <List.Item>{t('help.featSTTLive3Pre')} <Tag color="cyan">{t('recording.liveTranscribe')}</Tag> {t('help.featSTTLive3Post')}</List.Item>
                <List.Item>{t('help.featSTTLive4')}</List.Item>
                <List.Item>{t('help.featSTTLive5')}</List.Item>
              </List>

              <Text strong style={{ marginTop: '12px', display: 'block' }}>{t('help.featSTTFileHeader')}</Text>
              <List size="small">
                <List.Item>{t('help.featSTTFile1')}</List.Item>
                <List.Item>{t('help.featSTTFile2')}</List.Item>
                <List.Item>{t('help.featSTTFile3')}</List.Item>
                <List.Item>{t('help.featSTTFile4')}</List.Item>
                <List.Item>{t('help.featSTTFile5')}</List.Item>
                <List.Item>{t('help.featSTTFile6Pre')} <Tag color="orange" icon={<span>⚙️</span>}>{t('recording.configure')}</Tag> {t('help.featSTTFile6Post')}</List.Item>
              </List>

              <Divider style={{ margin: '8px 0' }} />

              <Text strong>{t('help.featSTTCommonHeader')}</Text>
              <List size="small">
                <List.Item>• <strong>{t('help.featSTTCommon1Bold')}</strong> {t('help.featSTTCommon1Post')}</List.Item>
                <List.Item>• <strong>{t('help.featSTTCommon2Bold')}</strong> {t('help.featSTTCommon2Post')}</List.Item>
                <List.Item>{t('help.featSTTCommon3')}</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>{t('help.featAITitle')}</Title>
              <List size="small">
                <List.Item>• <strong>{t('help.featAI1Bold')}</strong> {t('help.featAI1Post')}</List.Item>
                <List.Item>• <strong>{t('help.featAI2Bold')}</strong> {t('help.featAI2Post')}</List.Item>
                <List.Item>{t('help.featAI3Pre')} <Tag color="orange" icon={<span>⚙️</span>}>{t('recording.configure')}</Tag> {t('help.featAI3Post')}</List.Item>
                <List.Item>{t('help.featAI4')}</List.Item>
                <List.Item>{t('help.featAI5')}</List.Item>
                <List.Item>{t('help.featAI6Pre')} <Tag color="purple">{t('transcriptionPanel.refineAI')}</Tag> {t('help.featAI6Post')}</List.Item>
                <List.Item>• <strong>{t('help.featAI7Bold')}</strong> {t('help.featAI7Post')}</List.Item>
                <List.Item>{t('help.featAI8')}</List.Item>
                <List.Item>• <Text type="danger"><strong>{t('help.featAI9Bold')}</strong></Text> {t('help.featAI9Post')}</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>{t('help.featAudioTitle')}</Title>
              <List size="small">
                <List.Item>{t('help.featAudio1')}</List.Item>
                <List.Item>{t('help.featAudio2')}</List.Item>
                <List.Item>• <strong>{t('help.featAudio3Bold')}</strong> {t('help.featAudio3Post')}</List.Item>
                <List.Item>• <strong>{t('help.featAudio4Bold')}</strong></List.Item>
                <List.Item style={{ paddingLeft: '32px' }}>{t('help.featAudio5')}</List.Item>
                <List.Item style={{ paddingLeft: '32px' }}>{t('help.featAudio6')}</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>{t('help.featSaveTitle')}</Title>
              <Paragraph><strong>Chrome/Edge:</strong> {t('help.featSaveChrome')}</Paragraph>
              <Paragraph><strong>Safari/Firefox:</strong> {t('help.featSaveSafari')}</Paragraph>
              <Paragraph><strong>{t('help.featSaveFilesTitle')}</strong></Paragraph>
              <List size="small">
                <List.Item>📄 <Text code>[ProjectName].webm</Text> - {t('help.featSaveFile1')}</List.Item>
                <List.Item>📄 <Text code>[ProjectName]_meeting_info.json</Text> - {t('help.featSaveFile2')}</List.Item>
                <List.Item>📄 <Text code>[ProjectName]_metadata.json</Text> - {t('help.featSaveFile3')}</List.Item>
                <List.Item>📄 <Text code>[ProjectName]_transcription.json</Text> - {t('help.featSaveFile4')}</List.Item>
                <List.Item>📄 <Text code>[ProjectName]_rawTranscripts.json</Text> - {t('help.featSaveFile5')}</List.Item>
                <List.Item>📄 <Text code>[ProjectName].docx</Text> - {t('help.featSaveFile6')}</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>{t('help.featBackupTitle')}</Title>
              <List size="small">
                <List.Item>{t('help.featBackup1')}</List.Item>
                <List.Item>{t('help.featBackup2')}</List.Item>
                <List.Item>{t('help.featBackup3')}</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>{t('help.featUpdateTitle')}</Title>
              <List size="small">
                <List.Item>{t('help.featUpdate1')}</List.Item>
                <List.Item>{t('help.featUpdate2')}</List.Item>
                <List.Item>{t('help.featUpdate3')}</List.Item>
                <List.Item>{t('help.featUpdate4')}</List.Item>
                <List.Item>{t('help.featUpdate5Pre')} <Tag color="orange">⚙️{t('recording.configure')}</Tag> {t('help.featUpdate5Post')}</List.Item>
              </List>
            </div>
          </Space>
        </div>
      ),
    },
    {
      key: '3',
      label: t('help.tabGuide'),
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Title level={4}>{t('help.s1Title')}</Title>
              <List>
                <List.Item>{t('help.s1Step1Pre')} <Tag color="blue">{t('recording.selectFolder')}</Tag> {t('help.s1Step1Post')}</List.Item>
                <List.Item>{t('help.s1Step2')}</List.Item>
                <List.Item><strong>{t('help.s1Step3')}</strong>
                  <List size="small" style={{marginTop: 8}}>
                    <List.Item>{t('help.s1Config1Pre')} <Tag color="orange">⚙️{t('recording.configure')}</Tag> {t('help.s1Config1Post')}</List.Item>
                    <List.Item>{t('help.s1Config2')}</List.Item>
                    <List.Item>{t('help.s1Config3')}</List.Item>
                    <List.Item>{t('help.s1Config4')}</List.Item>
                    <List.Item>{t('help.s1Config5')}</List.Item>
                    <List.Item>{t('help.s1Config6')}</List.Item>
                  </List>
                </List.Item>
                <List.Item>{t('help.s1Step4Pre')} <Tag color="cyan">{t('recording.liveTranscribe')}</Tag> {t('help.s1Step4Post')}</List.Item>
                <List.Item>{t('help.s1Step5Pre')} <Tag color="red">{t('recording.start')}</Tag> {t('help.s1Step5Post')}</List.Item>
                <List.Item>{t('help.s1Step6')}</List.Item>
                <List.Item><strong>{t('help.s1Step7')}</strong>
                  <List size="small" style={{marginTop: 8}}>
                    <List.Item>{t('help.s1Step7a')}</List.Item>
                    <List.Item>{t('help.s1Step7bPre')} <Tag color="purple">{t('transcriptionPanel.refineAI')}</Tag> {t('help.s1Step7bPost')}</List.Item>
                  </List>
                </List.Item>
                <List.Item>{t('help.s1Step8Pre')} <Tag>{t('recording.stop')}</Tag> {t('help.s1Step8Post')}</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>{t('help.s2Title')}</Title>
              <List>
                <List.Item>{t('help.s2Step1Pre')} <Tag color="blue">{t('recording.selectFolder')}</Tag> {t('help.s2Step1Post')}</List.Item>
                <List.Item>{t('help.s2Step2')}</List.Item>
                <List.Item>{t('help.s2Step3')}</List.Item>
                <List.Item>{t('help.s2Step4Pre')} <Tag color="green">{t('recording.saveNotes')}</Tag> {t('help.s2Step4Post')}</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>{t('help.s3Title')}</Title>
              <List>
                <List.Item>{t('help.s3Step1Pre')} <Tag color="purple">{t('recording.loadProject')}</Tag> {t('help.s3Step1Post')}</List.Item>
                <List.Item>{t('help.s3Step2')}</List.Item>
                <List.Item>{t('help.s3Step3')}</List.Item>
                <List.Item>{t('help.s3Step4Pre')} <Tag color="green">{t('recording.saveChanges')}</Tag> {t('help.s3Step4Post')}</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>{t('help.s4Title')}</Title>
              <List>
                <List.Item>{t('help.s4Step1')}</List.Item>
                <List.Item>{t('help.s4Step2')}</List.Item>
                <List.Item>{t('help.s4Step3')}</List.Item>
                <List.Item>{t('help.s4Step4')}</List.Item>
                <List.Item>{t('help.s4Step5')}</List.Item>
                <List.Item style={{ paddingLeft: '32px' }}>{t('help.s4Step5a')}</List.Item>
                <List.Item style={{ paddingLeft: '32px' }}>{t('help.s4Step5b')}</List.Item>
                <List.Item>{t('help.s4Step6')}</List.Item>
              </List>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div>
              <Title level={4}>{t('help.shortcutsTitle')}</Title>
              <List>
                <List.Item>
                  <Tag color="blue">Enter</Tag> {t('help.shortcutEnterDesc')}
                </List.Item>
                <List.Item>
                  <Tag>Space</Tag> {t('help.shortcutSpaceDesc')}
                </List.Item>
              </List>

              <Divider />

              <Title level={4}>{t('help.mouseOpsTitle')}</Title>
              <List>
                <List.Item>
                  <strong>{t('help.mouseDblTimestamp')}</strong> {t('help.mouseDblTimestampResult')}
                </List.Item>
                <List.Item>
                  <strong>{t('help.mouseDblWaveform')}</strong> {t('help.mouseDblWaveformResult')}
                </List.Item>
                <List.Item>
                  <strong>{t('help.mouseRightWaveform')}</strong> {t('help.mouseRightWaveformResult')}
                </List.Item>
                <List.Item style={{ paddingLeft: '32px' }}>
                  • <strong>{t('help.mouseInsertTimestamp')}</strong> {t('help.mouseInsertTimestampResult')}
                </List.Item>
                <List.Item style={{ paddingLeft: '32px' }}>
                  • <strong>{t('help.mouseTranscribe')}</strong> {t('help.mouseTranscribeResult')}
                </List.Item>
              </List>
            </div>
          </Space>
        </div>
      ),
    },
    {
      key: '4',
      label: t('help.tabCompatibility'),
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Title level={4}>{t('help.compatBrowsers')}</Title>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #434343' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>{t('help.compatFeature')}</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>{t('help.compatChrome')}</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>{t('help.compatSafari')}</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>{t('help.compatFirefox')}</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #434343' }}>
                <td style={{ padding: '8px' }}>{t('help.compat1')}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>{t('help.compatSafari141')}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #434343' }}>
                <td style={{ padding: '8px' }}>{t('help.compat2')}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>{t('help.compatUnstable')}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>{t('help.compatUnstable')}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #434343' }}>
                <td style={{ padding: '8px' }}>{t('help.compat3')}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>{t('help.compatDirect')}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>{t('help.compatDownload')}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>{t('help.compatDownload')}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #434343' }}>
                <td style={{ padding: '8px' }}>{t('help.compat4')}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #434343' }}>
                <td style={{ padding: '8px' }}>{t('help.compat5')}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>✅</td>
              </tr>
            </tbody>
          </table>
          <Paragraph style={{ marginTop: 16 }}>
            {t('help.browserRecommend')}
          </Paragraph>
        </div>
      ),
    },
    {
      key: '5',
      label: t('help.tabPrivacy'),
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Title level={4}>{t('help.privacyTitle')}</Title>
          <List>
            <List.Item>{t('help.privacy1')}</List.Item>
            <List.Item>{t('help.privacy2')}</List.Item>
            <List.Item>{t('help.privacy3')}</List.Item>
            <List.Item>{t('help.privacy4')}</List.Item>
          </List>

          <Divider />

          <Title level={4}>{t('help.useCasesTitle')}</Title>
          <List>
            <List.Item>{t('help.useCase1')}</List.Item>
            <List.Item>{t('help.useCase2')}</List.Item>
            <List.Item>{t('help.useCase3')}</List.Item>
            <List.Item>{t('help.useCase4')}</List.Item>
            <List.Item>{t('help.useCase5')}</List.Item>
          </List>
        </div>
      ),
    },
    {
      key: '6',
      label: t('help.tabAuthor'),
      children: (
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px' }}>
          <Paragraph>
            {t('help.authorName')}<br />
            <br />
            <Text>
              <Text strong style={{ fontSize: 16 }}>LiveMeetingNotes</Text>{" "}
              {t('help.authorDesc')}
              <br />
              <br />
              {t('help.authorFree')}
              <br />
              <br />
              {t('help.donateDesc')}<br />
              {t('help.donateNote')}{" "}
              <Text code>LiveMeetingNotes chung tay cùng trẻ em Việt Nam</Text>
              <br />
              <br />
              <Text strong type="danger">{t('help.authorNote')}</Text>
              <br />
              <Text strong>{t('help.authorNote1')}</Text>
              <br />
              {t('help.authorNote2')}
              <br />
              {t('help.authorNote3')}
              <br />
            </Text>
          </Paragraph>
          <List
            size="small"
            header={<Text strong>{t('help.bankInfo')}</Text>}
            dataSource={[
              <React.Fragment key="bank">
                <Text strong>{t('help.bankAccount')}</Text> <br />
                <Text copyable>{t('help.bankNumber')}</Text>
              </React.Fragment>,
              <React.Fragment key="thanks">
                <Text type="secondary" italic>{t('help.authorThanks')}</Text>
              </React.Fragment>
            ]}
            renderItem={item => <List.Item>{item}</List.Item>}
          />
          <Text strong>{t('help.contactInfo')}</Text>
          <List
            size="small"
            header={<Text strong>{t('help.contactList')}</Text>}
            dataSource={[
              <React.Fragment key="fb">
                <Text strong>✌️Facebook:</Text>{' '}
                <a href="https://facebook.com/dachungbka" target="_blank" rel="noopener noreferrer">
                  https://facebook.com/dachungbka
                </a>
              </React.Fragment>,
              <React.Fragment key="tg">
                <Text strong>🌀Telegram:</Text>{' '}
                <a href="https://t.me/hungnd99" target="_blank" rel="noopener noreferrer">
                  https://t.me/hungnd99
                </a>
              </React.Fragment>,
              <React.Fragment key="email">
                <Text strong>📬Email:</Text> <a href="mailto:dachungbk@gmail.com">dachungbk@gmail.com</a>
              </React.Fragment>
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
        {t('help.button')}
      </Button>

      <Modal
        title={t('help.title')}
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
