import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Space, Alert, Modal, Form, Input, Select, Switch, message, Popconfirm, Card, Typography, theme } from 'antd';
import { PlusOutlined, ReloadOutlined, DeleteOutlined, EditOutlined, SendOutlined, ApiOutlined } from '@ant-design/icons';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  botId: string | null;
  hasSecret: boolean;
  enabled: boolean;
  deliveryCount?: number;
  lastStatus?: string | null;
  lastError?: string | null;
  lastDeliveredAt?: string | null;
  createdAt: string;
}

interface BotRef {
  id: string;
  name: string;
}

const eventOptions = [
  { value: 'message', label: 'Message' },
  { value: 'follow', label: 'Follow' },
  { value: 'subscribe', label: 'Subscribe' },
  { value: 'donation', label: 'Donation' },
  { value: 'comment', label: 'Comment' },
  { value: 'interval', label: 'Interval' },
  { value: 'status', label: 'Status' },
];

function Webhooks() {
  const { token } = theme.useToken();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [bots, setBots] = useState<BotRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [form] = Form.useForm();

  const fetchWebhooks = () => {
    setLoading(true);
    api.get<Webhook[]>('/webhooks')
      .then((data) => { setWebhooks(data); setError(null); })
      .catch(setError)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchWebhooks();
    api.get<BotRef[]>('/bots').then(setBots).catch(() => undefined);
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ botId: undefined, enabled: true });
    setModalOpen(true);
  };

  const openEdit = (webhook: Webhook) => {
    setEditing(webhook);
    form.resetFields();
    form.setFieldsValue({ name: webhook.name, url: webhook.url, events: webhook.events, botId: webhook.botId, enabled: webhook.enabled });
    setModalOpen(true);
  };

  const handleSubmit = async (values: {
    name: string; url: string; events: string[]; botId?: string; secret?: string; enabled: boolean;
  }) => {
    const payload: Record<string, unknown> = {
      name: values.name,
      url: values.url,
      events: values.events,
      botId: values.botId ?? null,
      enabled: values.enabled,
    };
    if (values.secret) payload.secret = values.secret;
    try {
      if (editing) {
        await api.patch(`/webhooks/${editing.id}`, payload);
        message.success('Webhook updated');
      } else {
        await api.post('/webhooks', payload);
        message.success('Webhook created');
      }
      setModalOpen(false);
      form.resetFields();
      fetchWebhooks();
    } catch (err) { message.error(String(err)); }
  };

  const handleDelete = async (id: string) => {
    try { await api.delete(`/webhooks/${id}`); message.success('Webhook deleted'); fetchWebhooks(); }
    catch (err) { message.error(String(err)); }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      await api.post(`/webhooks/${id}/test`);
      message.success('Test webhook delivered');
    } catch (err) {
      message.error(`Delivery failed: ${(err as Error).message}`);
    } finally {
      setTesting(null);
    }
  };

  const botName = (id: string | null) => bots.find((b) => b.id === id)?.name ?? (id ? id : null);

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    {
      title: 'URL', dataIndex: 'url', key: 'url',
      render: (u: string) => /^https?:\/\//i.test(u)
        ? <a href={u} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all', color: token.colorPrimary }}>{u}</a>
        : <span style={{ wordBreak: 'break-all' }}>{u}</span>,
    },
    {
      title: 'Events', dataIndex: 'events', key: 'events',
      render: (events: string[]) => events.map((e) => <Tag key={e} color="processing" style={{ borderRadius: 999 }}>{e}</Tag>),
    },
    {
      title: 'Target', key: 'botId',
      render: (_: unknown, record: Webhook) => record.botId ? <Tag color="success" style={{ borderRadius: 999 }}>{botName(record.botId)}</Tag> : <Tag style={{ borderRadius: 999 }}>All bots</Tag>,
    },
    {
      title: 'Enabled', dataIndex: 'enabled', key: 'enabled',
      render: (v: boolean) => v ? <Tag color="success" style={{ borderRadius: 999 }}>enabled</Tag> : <Tag style={{ borderRadius: 999 }}>disabled</Tag>,
    },
    {
      title: 'Delivery', key: 'delivery',
      render: (_: unknown, record: Webhook) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Tag color={record.lastStatus === 'ok' ? 'success' : record.lastStatus === 'failed' ? 'error' : 'default'} style={{ borderRadius: 999 }}>
              {record.lastStatus === 'ok' ? 'ok' : record.lastStatus === 'failed' ? 'failed' : 'never'}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{record.deliveryCount ?? 0} deliveries</Typography.Text>
          </Space>
          {record.lastDeliveredAt && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{new Date(record.lastDeliveredAt).toLocaleString()}</Typography.Text>
          )}
          {record.lastError && <span style={{ color: '#ef4444', fontSize: 12 }}>{record.lastError}</span>}
        </Space>
      ),
    },
    { title: 'Created', dataIndex: 'createdAt', key: 'createdAt', render: (t: string) => <Typography.Text type="secondary">{new Date(t).toLocaleString()}</Typography.Text> },
    {
      title: 'Actions', key: 'actions', width: 232,
      render: (_: unknown, record: Webhook) => (
        <Space>
          <Button size="small" icon={<SendOutlined />} loading={testing === record.id} onClick={() => handleTest(record.id)}>Test</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>Edit</Button>
          <Popconfirm title="Delete this webhook?" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (error) return <Alert type="error" message={error} />;

  return (
    <div>
      <PageHeader
        title="Webhooks"
        description="Notify external services when bots observe events"
        extra={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Create Webhook</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchWebhooks}>Refresh</Button>
          </>
        }
      />
      <Card className="bh-card" variant="borderless">
        <Table dataSource={webhooks} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20, showTotal: (t) => `${t} webhook${t === 1 ? '' : 's'}` }} />
      </Card>
      <Modal title={<span><ApiOutlined style={{ color: token.colorPrimary }} /> {editing ? 'Edit Webhook' : 'Create Webhook'}</span>} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Enter a name' }]}><Input placeholder="e.g. Discord alerts" /></Form.Item>
          <Form.Item name="url" label="URL" rules={[{ required: true, message: 'Enter an http(s) URL' }]}><Input placeholder="https://example.com/hook" /></Form.Item>
          <Form.Item name="events" label="Events" rules={[{ required: true, message: 'Pick at least one event' }]}>
            <Select mode="multiple" options={eventOptions} placeholder="Which events should trigger this webhook?" />
          </Form.Item>
          <Form.Item name="botId" label="Bot">
            <Select
              allowClear
              placeholder="All bots"
              options={bots.map((b) => ({ value: b.id, label: b.name }))}
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="secret" label="Secret (optional, for HMAC signing)">
            <Input.Password autoComplete="new-password" placeholder="Signed as X-BotHive-Signature" />
          </Form.Item>
          <Form.Item name="enabled" label="Enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default Webhooks;
