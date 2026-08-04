import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Space, Alert, Modal, Form, Input, Select, Switch, message, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined, DeleteOutlined, EditOutlined, SendOutlined } from '@ant-design/icons';
import { api } from '../api';

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
    // Reset first so a secret typed during a previous create/edit is not
    // carried into this edit (which would clobber the stored HMAC secret).
    form.resetFields();
    // Never prefill the secret (the API only exposes hasSecret); leaving the
    // field blank keeps the existing secret untouched.
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
    // Only send a secret when the operator typed a new one, so editing does
    // not clobber the existing HMAC secret.
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
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'URL', dataIndex: 'url', key: 'url',
      render: (u: string) => /^https?:\/\//i.test(u)
        ? <a href={u} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>{u}</a>
        : <span style={{ wordBreak: 'break-all' }}>{u}</span>,
    },
    {
      title: 'Events', dataIndex: 'events', key: 'events',
      render: (events: string[]) => events.map((e) => <Tag key={e} color="blue">{e}</Tag>),
    },
    {
      title: 'Target', key: 'botId',
      render: (_: unknown, record: Webhook) => record.botId ? <Tag color="green">{botName(record.botId)}</Tag> : <Tag>All bots</Tag>,
    },
    {
      title: 'Enabled', dataIndex: 'enabled', key: 'enabled',
      render: (v: boolean) => v ? <Tag color="success">enabled</Tag> : <Tag>disabled</Tag>,
    },
    {
      title: 'Delivery', key: 'delivery',
      render: (_: unknown, record: Webhook) => (
        <Space direction="vertical" size={0}>
          <Space size={4}>
            <Tag color={record.lastStatus === 'ok' ? 'green' : record.lastStatus === 'failed' ? 'red' : 'default'}>
              {record.lastStatus === 'ok' ? 'ok' : record.lastStatus === 'failed' ? 'failed' : 'never'}
            </Tag>
            <span style={{ color: '#888', fontSize: 12 }}>{record.deliveryCount ?? 0} deliveries</span>
          </Space>
          {record.lastDeliveredAt && (
            <span style={{ color: '#888', fontSize: 12 }}>{new Date(record.lastDeliveredAt).toLocaleString()}</span>
          )}
          {record.lastError && <span style={{ color: '#cf1322', fontSize: 12 }}>{record.lastError}</span>}
        </Space>
      ),
    },
    { title: 'Created', dataIndex: 'createdAt', key: 'createdAt', render: (t: string) => new Date(t).toLocaleString() },
    {
      title: 'Actions', key: 'actions', width: 230,
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
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Create Webhook</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchWebhooks}>Refresh</Button>
      </Space>
      <Table dataSource={webhooks} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} />
      <Modal title={editing ? 'Edit Webhook' : 'Create Webhook'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()}>
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
