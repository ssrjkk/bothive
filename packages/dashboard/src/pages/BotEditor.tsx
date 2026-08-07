import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Tag, Button, Space, Table, Input, message, Tabs, Modal, Form, Select, Switch, InputNumber, Popconfirm, Typography, theme, Alert } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, PlayCircleOutlined, PauseCircleOutlined, DeleteOutlined, PlusOutlined, ThunderboltOutlined, DatabaseOutlined, CodeOutlined } from '@ant-design/icons';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { PageSkeleton } from '../components/PageSkeleton';
import { ErrorState } from '../components/ErrorState';
import { StatusBadge, PlatformTag, LevelTag, TRIGGER_TAGS } from '../components/meta';

interface BotDetail {
  id: string; name: string; platform: string; status: string;
  config: Record<string, unknown>;
  account: { name: string; platform: string; id: string };
  logs: { id: string; level: string; message: string; createdAt: string }[];
  scripts: { id: string; name: string; trigger: string; enabled: boolean; config: Record<string, unknown> }[];
  createdAt: string; updatedAt: string; connectedAt?: string | null;
}

interface PatternParamSpec {
  key: string; label: string; type: string; required?: boolean;
  default?: string | number | boolean; placeholder?: string;
  options?: { value: string; label: string }[];
}

interface PatternSpec {
  id: string; name: string; description: string; platforms: string[];
  params: PatternParamSpec[];
}

interface MemoryEntry {
  key: string; value: unknown; ttl?: number; createdAt: string; expiresAt?: string;
}

const actionTypes = ['sendMessage', 'sendPhoto', 'deleteMessage', 'say', 'timeout', 'tweet', 'reply', 'react'];

const actionExamples: Record<string, string> = {
  sendMessage: '{ "chatId": 123456, "text": "Hello from BotHive" }',
  sendPhoto: '{ "chatId": 123456, "photo": "https://example.com/image.jpg", "caption": "Hi" }',
  deleteMessage: '{ "chatId": 123456, "messageId": 42 }',
  say: '{ "channel": "#mychannel", "message": "Hello stream!" }',
  timeout: '{ "channel": "#mychannel", "user": "troll", "seconds": 300, "reason": "spam" }',
  tweet: '{ "text": "Hello from BotHive" }',
  reply: '{ "text": "Hi!", "tweetId": "123456789" }',
  react: '{ "messageId": 42, "reaction": "👍" }',
};

function BotEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [bot, setBot] = useState<BotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scriptModalOpen, setScriptModalOpen] = useState(false);
  const [scriptForm] = Form.useForm();
  const [patterns, setPatterns] = useState<PatternSpec[]>([]);
  const [patternId, setPatternId] = useState<string>();
  const [genName, setGenName] = useState('');
  const [genValues, setGenValues] = useState<Record<string, unknown>>({});
  const [generating, setGenerating] = useState(false);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [actionForm] = Form.useForm();
  const [actionType, setActionType] = useState<string>('sendMessage');
  const [acting, setActing] = useState(false);

  const fetchBot = () => {
    if (!id) return;
    setLoading(true);
    api.get<BotDetail>(`/bots/${id}`).then(setBot).catch(setError).finally(() => setLoading(false));
  };

  useEffect(fetchBot, [id]);

  useEffect(() => {
    api.get<PatternSpec[]>('/scripts/patterns').then(setPatterns).catch(() => undefined);
  }, []);

  const selectedPattern = patterns.find((p) => p.id === patternId);

  const selectPattern = (pid: string) => {
    setPatternId(pid);
    const p = patterns.find((x) => x.id === pid);
    const init: Record<string, unknown> = {};
    if (p) for (const spec of p.params) if (spec.default !== undefined) init[spec.key] = spec.default;
    setGenValues(init);
  };

  const onGenerate = async () => {
    if (!id || !patternId) return;
    setGenerating(true);
    try {
      await api.post('/scripts/generate', { botId: id, name: genName, pattern: patternId, params: genValues });
      message.success('Script generated');
      fetchBot();
    } catch (err) { message.error(String(err)); }
    finally { setGenerating(false); }
  };

  const botAction = async (action: 'start' | 'stop') => {
    if (!id) return;
    try { await api.post(`/bots/${id}/${action}`); message.success(`Bot ${action} queued`); fetchBot(); }
    catch (err) { message.error(String(err)); }
  };

  const updateConfig = (value: string) => {
    if (!id) return;
    try {
      const parsed = JSON.parse(value);
      api.patch(`/bots/${id}`, { config: parsed })
        .then(() => message.success('Config updated'))
        .catch((e) => message.error(String(e)));
    } catch { message.error('Invalid JSON'); }
  };

  const createScript = async (values: { name: string; trigger: string; config: string }) => {
    if (!id) return;
    try {
      const config = JSON.parse(values.config);
      await api.post('/scripts', { botId: id, name: values.name, trigger: values.trigger, config });
      message.success('Script created');
      setScriptModalOpen(false);
      scriptForm.resetFields();
      fetchBot();
    } catch (err) { message.error(String(err)); }
  };

  const toggleScript = async (scriptId: string, enabled: boolean) => {
    try {
      await api.patch(`/scripts/${scriptId}`, { enabled });
      message.success(`Script ${enabled ? 'enabled' : 'disabled'}`);
      fetchBot();
    } catch (err) { message.error(String(err)); }
  };

  const testScript = async (scriptId: string) => {
    try {
      await api.post(`/scripts/${scriptId}/test`);
      message.success('Test triggered');
    } catch (err) { message.error(String(err)); }
  };

  const fetchMemory = () => {
    if (!id) return;
    setMemoryLoading(true);
    api.get<MemoryEntry[]>(`/bots/${id}/memory`).then(setMemory).catch(() => setMemory([])).finally(() => setMemoryLoading(false));
  };

  const deleteMemoryKey = async (key: string) => {
    if (!id) return;
    try {
      await api.delete(`/bots/${id}/memory/${encodeURIComponent(key)}`);
      message.success('Memory key deleted');
      fetchMemory();
    } catch (err) { message.error(String(err)); }
  };

  const clearMemory = async () => {
    if (!id) return;
    try {
      const data = await api.delete<{ cleared: number }>(`/bots/${id}/memory`);
      message.success(`Cleared ${data?.cleared ?? 0} key(s)`);
      fetchMemory();
    } catch (err) { message.error(String(err)); }
  };

  const runAction = async (values: { type: string; payload: string }) => {
    if (!id) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(values.payload || '{}');
    } catch {
      message.error('Payload must be valid JSON');
      return;
    }
    setActing(true);
    try {
      await api.post(`/bots/${id}/action`, { type: values.type, payload });
      message.success('Action queued');
    } catch (err) { message.error(String(err)); }
    finally { setActing(false); }
  };

  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={fetchBot} />;
  if (!bot) return null;

  return (
    <div>
      <PageHeader
        title={bot.name}
        description={
          <Space size={8}>
            <PlatformTag platform={bot.platform} />
            <StatusBadge status={bot.status} />
          </Space>
        }
        extra={
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/bots')}>Back</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchBot}>Refresh</Button>
            {bot.status !== 'running'
              ? <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => botAction('start')}>Start</Button>
              : <Button icon={<PauseCircleOutlined />} onClick={() => botAction('stop')}>Stop</Button>
            }
          </Space>
        }
      />

      <Tabs defaultActiveKey="info" items={[
        {
          key: 'info', label: 'Info',
          children: (
            <Card className="bh-card" variant="borderless">
              <Descriptions column={{ xs: 1, sm: 2 }} colon>
                <Descriptions.Item label="ID"><Typography.Text code style={{ fontSize: 12.5 }}>{bot.id}</Typography.Text></Descriptions.Item>
                <Descriptions.Item label="Platform"><PlatformTag platform={bot.platform} /></Descriptions.Item>
                <Descriptions.Item label="Status"><StatusBadge status={bot.status} /></Descriptions.Item>
                <Descriptions.Item label="Account">{bot.account.name}</Descriptions.Item>
                <Descriptions.Item label="Connected">{bot.connectedAt ? new Date(bot.connectedAt).toLocaleString() : '—'}</Descriptions.Item>
                <Descriptions.Item label="Created">{new Date(bot.createdAt).toLocaleString()}</Descriptions.Item>
                <Descriptions.Item label="Updated">{new Date(bot.updatedAt).toLocaleString()}</Descriptions.Item>
              </Descriptions>
              <Typography.Text strong style={{ display: 'block', margin: '16px 0 6px' }}>Config (JSON)</Typography.Text>
              <Input.TextArea rows={8} defaultValue={JSON.stringify(bot.config, null, 2)} onBlur={(e) => updateConfig(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12.5 }} />
            </Card>
          ),
        },
        {
          key: 'scripts', label: 'Scripts',
          children: (
            <Card
              className="bh-card"
              variant="borderless"
              title={<span style={{ fontWeight: 700 }}>Scripts ({bot.scripts.length})</span>}
              extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setScriptModalOpen(true)}>Add Script</Button>}
            >
              <Table dataSource={bot.scripts} columns={[
                { title: 'Name', dataIndex: 'name', key: 'name', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
                { title: 'Trigger', dataIndex: 'trigger', key: 'trigger', render: (t: string) => <Tag color={TRIGGER_TAGS[t] ?? 'default'} style={{ borderRadius: 999 }}>{t}</Tag> },
                { title: 'Enabled', dataIndex: 'enabled', key: 'enabled', render: (e: boolean, record: { id: string }) => <Switch checked={e} onChange={(v) => toggleScript(record.id, v)} /> },
                { title: 'Actions', key: 'actions', render: (_: unknown, record: { id: string }) => (
                  <Button size="small" icon={<ThunderboltOutlined />} onClick={() => testScript(record.id)}>Test</Button>
                ) },
              ]} rowKey="id" pagination={false} />
            </Card>
          ),
        },
        {
          key: 'generate', label: 'Generate',
          children: (
            <Card className="bh-card" variant="borderless" title={<span style={{ fontWeight: 700 }}>Generate script from pattern</span>}>
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <Space wrap>
                  <Select
                    style={{ width: 280 }}
                    placeholder="Choose a behavior pattern"
                    value={patternId}
                    onChange={selectPattern}
                    options={patterns.map((p) => ({ value: p.id, label: p.name }))}
                  />
                  {selectedPattern && (
                    <Space size={4}>
                      {selectedPattern.platforms.map((p) => <PlatformTag key={p} platform={p} />)}
                    </Space>
                  )}
                </Space>
                {selectedPattern && (
                  <>
                    <Alert type="info" showIcon message={selectedPattern.description} />
                    <Space style={{ width: '100%' }} wrap>
                      <span>Script name:</span>
                      <Input style={{ width: 280 }} placeholder="e.g. Welcome reply" value={genName} onChange={(e) => setGenName(e.target.value)} />
                    </Space>
                    {selectedPattern.params.map((spec) => (
                      <Space key={spec.key} style={{ width: '100%' }} wrap>
                        <span style={{ width: 180 }}>{spec.label}{spec.required && <span style={{ color: '#ef4444' }}> *</span>}</span>
                        {spec.type === 'select' && (
                          <Select
                            style={{ width: 360 }}
                            value={genValues[spec.key] as string | undefined}
                            onChange={(v) => setGenValues((prev) => ({ ...prev, [spec.key]: v }))}
                            options={spec.options}
                          />
                        )}
                        {spec.type === 'number' && (
                          <InputNumber
                            style={{ width: 360 }}
                            value={genValues[spec.key] as number | undefined}
                            onChange={(v) => setGenValues((prev) => ({ ...prev, [spec.key]: v }))}
                          />
                        )}
                        {spec.type === 'boolean' && (
                          <Switch checked={!!genValues[spec.key]} onChange={(v) => setGenValues((prev) => ({ ...prev, [spec.key]: v }))} />
                        )}
                        {(spec.type === 'string' || spec.type === 'text') && (
                          <Input.TextArea
                            style={{ width: 360 }}
                            rows={spec.type === 'text' ? 3 : 1}
                            placeholder={spec.placeholder}
                            value={genValues[spec.key] as string | undefined}
                            onChange={(e) => setGenValues((prev) => ({ ...prev, [spec.key]: e.target.value }))}
                          />
                        )}
                      </Space>
                    ))}
                    <Button type="primary" icon={<ThunderboltOutlined />} loading={generating} onClick={onGenerate}>Generate &amp; Create</Button>
                  </>
                )}
              </Space>
            </Card>
          ),
        },
        {
          key: 'logs', label: 'Logs',
          children: (
            <Card className="bh-card" variant="borderless" title={<span style={{ fontWeight: 700 }}>Recent logs</span>}>
              <Table dataSource={bot.logs} columns={[
                { title: 'Level', dataIndex: 'level', key: 'level', render: (l: string) => <LevelTag level={l} />, width: 110 },
                { title: 'Message', dataIndex: 'message', key: 'message' },
                { title: 'Time', dataIndex: 'createdAt', key: 'createdAt', render: (t: string) => <Typography.Text type="secondary">{new Date(t).toLocaleString()}</Typography.Text> },
              ]} rowKey="id" pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `${t} log${t === 1 ? '' : 's'}` }} size="middle" />
            </Card>
          ),
        },
        {
          key: 'actions', label: 'Actions',
          children: (
            <Card className="bh-card" variant="borderless" title={<span style={{ fontWeight: 700 }}><ThunderboltOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />Run a platform action</span>}>
              <Form form={actionForm} layout="vertical" onFinish={runAction} initialValues={{ type: 'sendMessage' }}>
                <Form.Item name="type" label="Action type" rules={[{ required: true }]}>
                  <Select
                    style={{ width: 280 }}
                    options={actionTypes.map((t) => ({ value: t, label: t }))}
                    onChange={(v) => setActionType(v)}
                  />
                </Form.Item>
                <Form.Item name="payload" label={`Payload (JSON) — e.g. ${actionExamples[actionType]}`}>
                  <Input.TextArea rows={6} placeholder={actionExamples[actionType]} style={{ fontFamily: 'monospace', fontSize: 12.5 }} />
                </Form.Item>
                <Button type="primary" icon={<ThunderboltOutlined />} loading={acting} htmlType="submit">Execute Action</Button>
              </Form>
            </Card>
          ),
        },
        {
          key: 'memory', label: 'Memory',
          children: (
            <Card
              className="bh-card"
              variant="borderless"
              title={<span style={{ fontWeight: 700 }}><DatabaseOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />Bot memory</span>}
              extra={
                <Space>
                  <Button size="small" icon={<ReloadOutlined />} onClick={fetchMemory}>Refresh</Button>
                  <Popconfirm title="Clear all memory keys for this bot?" onConfirm={clearMemory}>
                    <Button size="small" danger>Clear All</Button>
                  </Popconfirm>
                </Space>
              }
            >
              <Table dataSource={memory} loading={memoryLoading} rowKey="key" size="small" columns={[
                { title: 'Key', dataIndex: 'key', key: 'key', width: 240, render: (v: string) => <Typography.Text code style={{ fontSize: 12.5 }}>{v}</Typography.Text> },
                { title: 'Value', dataIndex: 'value', key: 'value', render: (v: unknown) => <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</pre> },
                { title: 'TTL (s)', dataIndex: 'ttl', key: 'ttl', width: 90, render: (t?: number) => (t ?? '—') },
                { title: 'Expires', dataIndex: 'expiresAt', key: 'expiresAt', width: 170, render: (t?: string) => (t ? <Typography.Text type="secondary">{new Date(t).toLocaleString()}</Typography.Text> : '—') },
                { title: 'Created', dataIndex: 'createdAt', key: 'createdAt', width: 170, render: (t: string) => <Typography.Text type="secondary">{new Date(t).toLocaleString()}</Typography.Text> },
                { title: 'Actions', key: 'actions', width: 80, render: (_: unknown, record: MemoryEntry) => (
                  <Popconfirm title="Delete this key?" onConfirm={() => deleteMemoryKey(record.key)}>
                    <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete memory key ${record.key}`} />
                  </Popconfirm>
                ) },
              ]} pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `${t} key${t === 1 ? '' : 's'}` }} />
            </Card>
          ),
        },
      ]} />

      <Modal
        title={<span><CodeOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />Add Script</span>}
        open={scriptModalOpen}
        onCancel={() => setScriptModalOpen(false)}
        onOk={() => scriptForm.submit()}
      >
        <Form form={scriptForm} layout="vertical" onFinish={createScript}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="trigger" label="Trigger" rules={[{ required: true }]}>
            <Select options={[
              { value: 'message', label: 'Message' }, { value: 'follow', label: 'Follow' },
              { value: 'subscribe', label: 'Subscribe' }, { value: 'donation', label: 'Donation' },
              { value: 'comment', label: 'Comment' },
            ]} />
          </Form.Item>
          <Form.Item name="config" label="Config (JSON)" rules={[{ required: true }]}>
            <Input.TextArea rows={8} placeholder='{"filters":[{"type":"regex","value":"!hello"}],"actions":[{"type":"reply","payload":{"text":"Hi there!"}}]}' style={{ fontFamily: 'monospace', fontSize: 12.5 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default BotEditor;
