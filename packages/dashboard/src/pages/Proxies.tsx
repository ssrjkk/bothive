import React, { useState } from 'react';
import {
  Table,
  Tag,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  message,
  Popconfirm,
  Card,
  Typography,
  Empty,
  Progress,
  theme,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  EditOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ErrorState } from '../components/ErrorState';
import { useApiResource } from '../hooks/useApiResource';

interface Proxy {
  id: string;
  url: string;
  type: string;
  priority: number;
  enabled: boolean;
  healthScore: number;
  lastFailedAt: string | null;
  requestsCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

function Proxies() {
  const { token } = theme.useToken();
  const proxies = useApiResource(() => api.get<Proxy[]>('/proxies'));
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Proxy | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [form] = Form.useForm();

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'http', priority: 0, enabled: true });
    setModalOpen(true);
  };

  const openEdit = (proxy: Proxy) => {
    setEditing(proxy);
    form.resetFields();
    form.setFieldsValue({
      url: proxy.url,
      type: proxy.type,
      priority: proxy.priority,
      enabled: proxy.enabled,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (values: {
    url: string;
    type: string;
    priority: number;
    enabled: boolean;
  }) => {
    try {
      if (editing) {
        await api.patch(`/proxies/${editing.id}`, values);
        message.success('Proxy updated');
      } else {
        await api.post('/proxies', values);
        message.success('Proxy created');
      }
      setModalOpen(false);
      form.resetFields();
      proxies.reload();
    } catch (err) {
      message.error(String(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/proxies/${id}`);
      message.success('Proxy deleted');
      proxies.reload();
    } catch (err) {
      message.error(String(err));
    }
  };

  const handleToggle = async (proxy: Proxy) => {
    try {
      await api.patch(`/proxies/${proxy.id}`, { enabled: !proxy.enabled });
      message.success(proxy.enabled ? 'Proxy disabled' : 'Proxy enabled');
      proxies.reload();
    } catch (err) {
      message.error(String(err));
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const res = await api.post<{ reachable: boolean }>(`/proxies/${id}/test`);
      if (res.reachable) {
        message.success('Proxy is reachable');
      } else {
        message.warning('Proxy is not reachable');
      }
      proxies.reload();
    } catch (err) {
      message.error(`Test failed: ${(err as Error).message}`);
    } finally {
      setTesting(null);
    }
  };

  const columns = [
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      render: (v: string) => (
        <Typography.Text
          copyable
          style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 13 }}
        >
          {v}
        </Typography.Text>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (t: string) => (
        <Tag color={t === 'socks5' ? 'purple' : 'blue'} style={{ borderRadius: 999 }}>
          {t}
        </Tag>
      ),
    },
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      width: 90,
      sorter: (a: Proxy, b: Proxy) => a.priority - b.priority,
    },
    {
      title: 'Health',
      key: 'health',
      width: 140,
      render: (_: unknown, record: Proxy) => (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Progress
            percent={record.healthScore}
            size="small"
            status={
              record.healthScore > 60 ? 'success' : record.healthScore > 30 ? 'normal' : 'exception'
            }
            format={(p) => `${p ?? 0}`}
          />
          {record.lastFailedAt && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              Failed {new Date(record.lastFailedAt).toLocaleString()}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Usage',
      key: 'usage',
      width: 120,
      render: (_: unknown, record: Proxy) => (
        <Space direction="vertical" size={2}>
          <Typography.Text style={{ fontSize: 12 }}>
            {record.requestsCount} requests
          </Typography.Text>
          {record.failureCount > 0 && (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              {record.failureCount} failures
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Enabled',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      render: (v: boolean, record: Proxy) => (
        <Switch
          size="small"
          checked={v}
          onChange={() => handleToggle(record)}
          checkedChildren="on"
          unCheckedChildren="off"
        />
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (t: string) => (
        <Typography.Text type="secondary">{new Date(t).toLocaleString()}</Typography.Text>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: Proxy) => (
        <Space>
          <Button
            size="small"
            icon={record.healthScore > 60 ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
            loading={testing === record.id}
            onClick={() => handleTest(record.id)}
          >
            Test
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            Edit
          </Button>
          <Popconfirm title="Delete this proxy?" onConfirm={() => handleDelete(record.id)}>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={`Delete proxy ${record.url}`}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (proxies.error) return <ErrorState error={proxies.error} onRetry={proxies.reload} />;

  return (
    <div>
      <PageHeader
        title="Proxies"
        description="Outbound proxy pool for platform connections"
        extra={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Proxy
            </Button>
            <Button icon={<ReloadOutlined />} onClick={proxies.reload}>
              Refresh
            </Button>
          </>
        }
      />
      <Card className="bh-card" variant="borderless">
        <Table
          dataSource={proxies.data ?? []}
          columns={columns}
          rowKey="id"
          loading={proxies.loading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (t: number) => `${t} prox${t === 1 ? 'y' : 'ies'}`,
          }}
          sticky
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No proxies configured — bots connect directly"
              >
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  Add Proxy
                </Button>
              </Empty>
            ),
          }}
        />
      </Card>
      <Modal
        title={
          <span>
            <ApiOutlined style={{ color: token.colorPrimary }} />{' '}
            {editing ? 'Edit Proxy' : 'Add Proxy'}
          </span>
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="url"
            label="URL"
            rules={[{ required: true, message: 'Enter a proxy URL' }]}
          >
            <Input placeholder="http://user:pass@host:port or socks5://host:port" />
          </Form.Item>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'http', label: 'HTTP' },
                { value: 'socks5', label: 'SOCKS5' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="priority"
            label="Priority"
            rules={[{ required: true, message: 'Enter a priority (0-100)' }]}
          >
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="enabled" label="Enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default Proxies;
