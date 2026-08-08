import React, { useEffect, useState } from 'react';
import {
  Table,
  Tag,
  Button,
  Space,
  Select,
  Input,
  Switch,
  message,
  Popconfirm,
  Modal,
  Form,
  Card,
  Empty,
  Typography,
  theme,
} from 'antd';
import {
  ReloadOutlined,
  DeleteOutlined,
  CopyOutlined,
  ThunderboltOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  EditOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ErrorState } from '../components/ErrorState';
import { PlatformTag, TRIGGER_TAGS } from '../components/meta';

interface ScriptRow {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  config: Record<string, unknown>;
  bot: { id: string; name: string; platform: string } | null;
  createdAt: string;
}

interface BotOption {
  id: string;
  name: string;
  platform: string;
}

function Scripts() {
  const { token } = theme.useToken();
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [bots, setBots] = useState<BotOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [botFilter, setBotFilter] = useState<string | undefined>();
  const [triggerFilter, setTriggerFilter] = useState<string | undefined>();
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScriptRow | null>(null);
  const [configText, setConfigText] = useState('');
  const [saving, setSaving] = useState(false);
  const [editForm] = Form.useForm();

  const fetchScripts = () => {
    setLoading(true);
    api
      .get<ScriptRow[]>('/scripts')
      .then(setScripts)
      .catch(setError)
      .finally(() => setLoading(false));
  };

  const fetchBots = () => {
    api
      .get<BotOption[]>('/bots')
      .then(setBots)
      .catch(() => setBots([]));
  };

  useEffect(fetchScripts, []);
  useEffect(fetchBots, []);

  const toggleScript = async (scriptId: string, enabled: boolean) => {
    try {
      await api.patch(`/scripts/${scriptId}`, { enabled });
      message.success(`Script ${enabled ? 'enabled' : 'disabled'}`);
      fetchScripts();
    } catch (err) {
      message.error(String(err));
    }
  };

  const testScript = async (scriptId: string) => {
    setActionLoading(scriptId);
    try {
      await api.post(`/scripts/${scriptId}/test`);
      message.success('Test triggered');
    } catch (err) {
      message.error(String(err));
    } finally {
      setActionLoading(null);
    }
  };

  const cloneScript = async (scriptId: string) => {
    setActionLoading(scriptId);
    try {
      await api.post(`/scripts/${scriptId}/clone`);
      message.success('Script duplicated');
      fetchScripts();
    } catch (err) {
      message.error(String(err));
    } finally {
      setActionLoading(null);
    }
  };

  const deleteScript = async (scriptId: string) => {
    try {
      await api.delete(`/scripts/${scriptId}`);
      message.success('Script deleted');
      setSelectedKeys((keys) => keys.filter((k) => k !== scriptId));
      fetchScripts();
    } catch (err) {
      message.error(String(err));
    }
  };

  const bulkAction = async (action: 'enable' | 'disable' | 'delete') => {
    if (selectedKeys.length === 0) return;
    setBulkLoading(true);
    try {
      const results = await api.post<{ id: string; status: string; error?: string }[]>(
        '/bulk/scripts',
        { ids: selectedKeys, action },
      );
      const failed = results.filter((r) => r.status === 'error');
      if (failed.length > 0)
        message.error(
          `${failed.length} script(s) failed: ${failed.map((r) => r.error).join(', ')}`,
        );
      else
        message.success(
          `${selectedKeys.length} script(s) ${action === 'delete' ? 'deleted' : action === 'enable' ? 'enabled' : 'disabled'}`,
        );
      setSelectedKeys([]);
      fetchScripts();
    } catch (err) {
      message.error(String(err));
    } finally {
      setBulkLoading(false);
    }
  };

  const openEdit = (script: ScriptRow) => {
    setEditing(script);
    setConfigText(JSON.stringify(script.config ?? {}, null, 2));
    editForm.setFieldsValue({
      name: script.name,
      trigger: script.trigger,
      enabled: script.enabled,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configText);
    } catch {
      message.error('Config must be valid JSON');
      return;
    }
    setSaving(true);
    try {
      const values = await editForm.validateFields();
      await api.patch(`/scripts/${editing.id}`, { ...values, config });
      message.success('Script updated');
      setEditing(null);
      fetchScripts();
    } catch (err) {
      message.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  const triggers = [...new Set(scripts.map((s) => s.trigger))];

  const visibleScripts = scripts.filter((s) => {
    if (botFilter && s.bot?.id !== botFilter) return false;
    if (triggerFilter && s.trigger !== triggerFilter) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span>,
    },
    {
      title: 'Bot',
      key: 'bot',
      render: (_: unknown, record: ScriptRow) =>
        record.bot ? (
          <Space size={6}>
            {record.bot.name}
            <PlatformTag platform={record.bot.platform} />
          </Space>
        ) : (
          <Tag style={{ borderRadius: 999 }}>—</Tag>
        ),
    },
    {
      title: 'Trigger',
      dataIndex: 'trigger',
      key: 'trigger',
      render: (t: string) => (
        <Tag color={TRIGGER_TAGS[t] ?? 'default'} style={{ borderRadius: 999 }}>
          {t}
        </Tag>
      ),
    },
    {
      title: 'Enabled',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (e: boolean, record: ScriptRow) => (
        <SwitchRender record={record} checked={e} onToggle={toggleScript} />
      ),
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
      width: 268,
      render: (_: unknown, record: ScriptRow) => (
        <Space>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            loading={actionLoading === record.id}
            onClick={() => testScript(record.id)}
          >
            Test
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            Edit
          </Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            loading={actionLoading === record.id}
            onClick={() => cloneScript(record.id)}
          >
            Copy
          </Button>
          <Popconfirm title="Delete this script?" onConfirm={() => deleteScript(record.id)}>
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

  if (error) return <ErrorState error={error} onRetry={fetchScripts} />;

  return (
    <div>
      <PageHeader
        title="Scripts"
        description="Automation behaviors wired to triggers and filters"
        extra={
          <Button icon={<ReloadOutlined />} onClick={fetchScripts}>
            Refresh
          </Button>
        }
      />
      <Card
        className="bh-card"
        variant="borderless"
        title={
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="Search scripts by name"
              style={{ width: 240 }}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              allowClear
              placeholder="Bot"
              style={{ width: 200 }}
              onChange={setBotFilter}
              options={bots.map((b) => ({ value: b.id, label: `${b.name} (${b.platform})` }))}
            />
            <Select
              allowClear
              placeholder="Trigger"
              style={{ width: 140 }}
              onChange={setTriggerFilter}
              options={triggers.map((t) => ({ value: t, label: t }))}
            />
            <Space>
              <Button
                size="small"
                icon={<PlayCircleOutlined />}
                disabled={selectedKeys.length === 0}
                loading={bulkLoading}
                onClick={() => bulkAction('enable')}
              >
                Enable
              </Button>
              <Button
                size="small"
                icon={<PauseCircleOutlined />}
                disabled={selectedKeys.length === 0}
                loading={bulkLoading}
                onClick={() => bulkAction('disable')}
              >
                Disable
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={selectedKeys.length === 0}
                loading={bulkLoading}
                onClick={() => bulkAction('delete')}
              >
                Delete
              </Button>
              <Typography.Text type="secondary">
                {selectedKeys.length > 0 ? `${selectedKeys.length} selected` : ''}
              </Typography.Text>
            </Space>
          </Space>
        }
      >
        <Table
          dataSource={visibleScripts}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (t) => `${t} script${t === 1 ? '' : 's'}`,
          }}
          sticky
          rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No scripts yet — generate one from the Bot editor"
              />
            ),
          }}
        />
      </Card>
      <Modal
        title={
          <span>
            <CodeOutlined style={{ color: token.colorPrimary }} /> Edit script —{' '}
            {editing?.name ?? ''}
          </span>
        }
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={saveEdit}
        confirmLoading={saving}
        okText="Save"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="trigger" label="Trigger" rules={[{ required: true }]}>
            <Select options={triggers.map((t) => ({ value: t, label: t }))} />
          </Form.Item>
          <Form.Item name="enabled" label="Enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="Config (JSON)">
            <Input.TextArea
              rows={10}
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 12.5 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function SwitchRender({
  checked,
  record,
  onToggle,
}: {
  checked: boolean;
  record: ScriptRow;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  return <Switch checked={checked} onChange={(v) => onToggle(record.id, v)} />;
}

export default Scripts;
