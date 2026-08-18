import React, { useEffect, useState } from 'react';
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Card,
  Tag,
  Typography,
  Empty,
  theme,
} from 'antd';
import { PlusOutlined, ReloadOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ErrorState } from '../components/ErrorState';
import { PlatformTag, StatusBadge, PLATFORMS } from '../components/meta';
import { useApiResource } from '../hooks/useApiResource';

interface Account {
  id: string;
  name: string;
  platform: string;
  credentials: Record<string, boolean>;
  _count: { bots: number };
  createdAt: string;
}

interface BotStatus {
  id: string;
  name: string;
  platform: string;
  status: string;
  accountId: string;
}

const credFields = [
  { name: 'token', label: 'Token / OAuth' },
  { name: 'clientId', label: 'Client ID' },
  { name: 'secret', label: 'Client Secret' },
  { name: 'refreshToken', label: 'Refresh Token' },
  { name: 'apiKey', label: 'API Key' },
  { name: 'apiSecret', label: 'API Secret' },
];

function Accounts() {
  const { token } = theme.useToken();
  const accounts = useApiResource(() => api.get<Account[]>('/accounts'));
  const [bots, setBots] = useState<BotStatus[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form] = Form.useForm();

  const fetchBots = () => {
    api
      .get<BotStatus[]>('/bots')
      .then(setBots)
      .catch(() => setBots([]));
  };

  useEffect(fetchBots, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (account: Account) => {
    setEditing(account);
    form.resetFields();
    form.setFieldsValue({ name: account.name, platform: account.platform });
    setModalOpen(true);
  };

  const handleSubmit = async (values: Record<string, string>) => {
    try {
      const credentials: Record<string, unknown> = {};
      for (const field of credFields) {
        if (values[field.name]) credentials[field.name] = values[field.name];
      }
      if (values.apiKeys) {
        try {
          const parsed = JSON.parse(values.apiKeys);
          if (!Array.isArray(parsed)) throw new Error('must be a JSON array');
          credentials.apiKeys = parsed;
        } catch (err) {
          message.error(
            `apiKeys must be a valid JSON array of { apiKey, apiSecret }: ${String(err)}`,
          );
          return;
        }
      }

      if (editing) {
        await api.patch(`/accounts/${editing.id}`, {
          name: values.name,
          platform: values.platform,
          credentials,
        });
        message.success('Account updated');
      } else {
        await api.post('/accounts', { name: values.name, platform: values.platform, credentials });
        message.success('Account created');
      }
      setModalOpen(false);
      form.resetFields();
      accounts.reload();
      fetchBots();
    } catch (err) {
      message.error(String(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/accounts/${id}`);
      message.success('Account deleted');
      accounts.reload();
      fetchBots();
    } catch (err) {
      message.error(String(err));
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span>,
    },
    {
      title: 'Platform',
      dataIndex: 'platform',
      key: 'platform',
      render: (p: string) => <PlatformTag platform={p} />,
    },
    {
      title: 'Credentials',
      key: 'credentials',
      render: (_: unknown, record: Account) => {
        const names = Object.keys(record.credentials);
        return names.length === 0 ? (
          <Tag style={{ borderRadius: 999 }}>none</Tag>
        ) : (
          names.map((n) => (
            <Tag key={n} color="processing" style={{ borderRadius: 999 }}>
              {n}
            </Tag>
          ))
        );
      },
    },
    {
      title: 'Bots',
      key: 'bots',
      render: (_: unknown, record: Account) => {
        const linked = bots.filter((b) => b.accountId === record.id);
        if (linked.length === 0)
          return <span style={{ color: token.colorTextSecondary }}>{record._count.bots}</span>;
        return (
          <Space direction="vertical" size={4}>
            <span>
              {linked.length} bot{linked.length === 1 ? '' : 's'}
            </span>
            <Space size={4} wrap>
              {linked.map((b) => (
                <StatusBadge key={b.id} status={b.status} />
              ))}
            </Space>
          </Space>
        );
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (t: string) => (
        <Typography.Text type="secondary">{new Date(t).toLocaleString()}</Typography.Text>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 160,
      render: (_: unknown, record: Account) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            Edit
          </Button>
          <Popconfirm title="Delete this account?" onConfirm={() => handleDelete(record.id)}>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={`Delete ${record.name}`}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (accounts.error) return <ErrorState error={accounts.error} onRetry={accounts.reload} />;

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Platform credentials — stored encrypted, never shown again"
        extra={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Create Account
            </Button>
            <Button icon={<ReloadOutlined />} onClick={accounts.reload}>
              Refresh
            </Button>
          </>
        }
      />
      <Card className="bh-card" variant="borderless">
        <Table
          dataSource={accounts.data ?? []}
          columns={columns}
          rowKey="id"
          loading={accounts.loading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (t) => `${t} account${t === 1 ? '' : 's'}`,
          }}
          sticky
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No accounts yet — connect a platform to get started"
              >
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  Create Account
                </Button>
              </Empty>
            ),
          }}
        />
      </Card>
      <Modal
        title={editing ? 'Edit Account' : 'Create Account'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Main Twitch" />
          </Form.Item>
          <Form.Item name="platform" label="Platform" rules={[{ required: true }]}>
            <Select options={PLATFORMS.map((p) => ({ value: p, label: p }))} />
          </Form.Item>
          {credFields.map((field) => (
            <Form.Item key={field.name} name={field.name} label={field.label}>
              <Input.Password
                autoComplete="new-password"
                placeholder={editing ? 'Enter new value to update' : 'Enter value'}
              />
            </Form.Item>
          ))}
          <Form.Item name="apiKeys" label="Extra API Key Pairs (JSON, for rotation)">
            <Input.TextArea
              rows={2}
              placeholder='[{"apiKey":"...","apiSecret":"..."}]'
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default Accounts;
