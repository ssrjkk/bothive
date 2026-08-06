import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Alert, Modal, Form, Input, Select, message, Popconfirm, Typography, Card, Empty, theme } from 'antd';
import { PlusOutlined, ReloadOutlined, PlayCircleOutlined, PauseCircleOutlined, DeleteOutlined, RobotOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, PlatformTag, platformHex } from '../components/meta';

interface Bot {
  id: string; name: string; platform: string; status: string;
  account: { name: string; id: string };
  _count: { logs: number }; createdAt: string; connectedAt?: string | null;
}

interface AccountOption {
  id: string; name: string; platform: string;
}

const platforms = ['telegram', 'twitch', 'youtube', 'twitter'];

function Bots() {
  const { token } = theme.useToken();
  const [bots, setBots] = useState<Bot[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const navigate = useNavigate();

  const fetchBots = () => {
    setLoading(true);
    api.get<Bot[]>('/bots').then(setBots).catch(setError).finally(() => setLoading(false));
  };

  const fetchAccounts = () => {
    api.get<AccountOption[]>('/accounts')
      .then(setAccounts)
      .catch(() => setAccounts([]));
  };

  useEffect(fetchBots, []);
  useEffect(fetchAccounts, []);

  const handleCreate = async (values: { name: string; platform: string; accountId: string }) => {
    try {
      await api.post('/bots', { ...values, config: { pollingInterval: 5000 } });
      message.success('Bot created');
      setModalOpen(false);
      form.resetFields();
      fetchBots();
    } catch (err) { message.error(String(err)); }
  };

  const botAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setActionLoading(id);
    try {
      await api.post(`/bots/${id}/${action}`);
      message.success(`Bot ${action} queued`);
      fetchBots();
    } catch (err) { message.error(String(err)); }
    finally { setActionLoading(null); }
  };

  const handleDelete = async (id: string) => {
    try { await api.delete(`/bots/${id}`); message.success('Bot deleted'); fetchBots(); }
    catch (err) { message.error(String(err)); }
  };

  const columns = [
    {
      title: 'Name', dataIndex: 'name', key: 'name',
      render: (name: string, record: Bot) => (
        <a onClick={() => navigate(`/bots/${record.id}`)} style={{ fontWeight: 600, color: token.colorText }}>
          <span className="bh-dot" style={{ background: platformHex(record.platform), marginRight: 8, verticalAlign: 1 }} />
          {name}
        </a>
      ),
    },
    { title: 'Platform', dataIndex: 'platform', key: 'platform', render: (p: string) => <PlatformTag platform={p} /> },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (s: string) => <StatusBadge status={s} /> },
    { title: 'Account', dataIndex: ['account', 'name'], key: 'account' },
    { title: 'Connected', dataIndex: 'connectedAt', key: 'connectedAt', render: (t?: string | null) => (t ? new Date(t).toLocaleString() : <span style={{ color: token.colorTextQuaternary }}>—</span>) },
    { title: 'Logs', dataIndex: ['_count', 'logs'], key: 'logs', render: (v: number) => <Typography.Text type="secondary">{v}</Typography.Text> },
    {
      title: 'Actions', key: 'actions', width: 252,
      render: (_: unknown, record: Bot) => (
        <Space>
          {record.status === 'running'
            ? <Button size="small" icon={<PauseCircleOutlined />} loading={actionLoading === record.id} onClick={() => botAction(record.id, 'stop')}>Stop</Button>
            : <Button size="small" type="primary" icon={<PlayCircleOutlined />} loading={actionLoading === record.id} disabled={record.status === 'connecting' || record.status === 'reconnecting'} onClick={() => botAction(record.id, 'start')}>Start</Button>
          }
          <Button size="small" loading={actionLoading === record.id} onClick={() => botAction(record.id, 'restart')}>Restart</Button>
          <Popconfirm title="Delete this bot?" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (error) return <Alert type="error" message={error} />;

  const visibleBots = bots.filter((b) => {
    if (platformFilter && b.platform !== platformFilter) return false;
    if (statusFilter && b.status !== statusFilter) return false;
    if (search && !b.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Bots"
        description={`${bots.length} bot${bots.length === 1 ? '' : 's'} across your accounts`}
        extra={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Create Bot</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchBots}>Refresh</Button>
          </>
        }
      />
      <Card
        className="bh-card"
        variant="borderless"
        title={<Space wrap><Input.Search allowClear placeholder="Search bots by name" style={{ width: 240 }} onChange={(e) => setSearch(e.target.value)} /><Select allowClear placeholder="Platform" style={{ width: 140 }} onChange={setPlatformFilter} options={platforms.map((p) => ({ value: p, label: p }))} /><Select allowClear placeholder="Status" style={{ width: 140 }} onChange={setStatusFilter} options={['running', 'idle', 'paused', 'error', 'connecting', 'reconnecting'].map((s) => ({ value: s, label: s }))} /></Space>}
      >
        <Table
          dataSource={visibleBots}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, showTotal: (t) => `${t} bot${t === 1 ? '' : 's'}` }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No bots match your filters"><Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Create your first bot</Button></Empty> }}
        />
      </Card>
      <Modal title={<span><RobotOutlined style={{ color: token.colorPrimary }} /> Create Bot</span>} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input placeholder="e.g. Stream Assistant" /></Form.Item>
          <Form.Item name="platform" label="Platform" rules={[{ required: true }]}>
            <Select options={platforms.map((p) => ({ value: p, label: p }))} />
          </Form.Item>
          <Form.Item name="accountId" label="Account" rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder="Select account"
              optionFilterProp="label"
              options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.platform})` }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default Bots;
