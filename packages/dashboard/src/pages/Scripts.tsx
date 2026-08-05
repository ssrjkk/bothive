import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Space, Alert, Select, Input, Switch, message, Popconfirm, Modal, Form } from 'antd';
import { ReloadOutlined, DeleteOutlined, CopyOutlined, ThunderboltOutlined, PlayCircleOutlined, PauseCircleOutlined, EditOutlined } from '@ant-design/icons';
import { api } from '../api';

interface ScriptRow {
  id: string; name: string; trigger: string; enabled: boolean; config: Record<string, unknown>;
  bot: { id: string; name: string; platform: string } | null;
  createdAt: string;
}

interface BotOption {
  id: string; name: string; platform: string;
}

const triggerColors: Record<string, string> = {
  message: 'blue', follow: 'green', subscribe: 'purple', donation: 'gold',
  comment: 'cyan', interval: 'geekblue', status: 'magenta',
};

function Scripts() {
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
    api.get<ScriptRow[]>('/scripts').then(setScripts).catch(setError).finally(() => setLoading(false));
  };

  const fetchBots = () => {
    api.get<BotOption[]>('/bots').then(setBots).catch(() => setBots([]));
  };

  useEffect(fetchScripts, []);
  useEffect(fetchBots, []);

  const toggleScript = async (scriptId: string, enabled: boolean) => {
    try {
      await api.patch(`/scripts/${scriptId}`, { enabled });
      message.success(`Script ${enabled ? 'enabled' : 'disabled'}`);
      fetchScripts();
    } catch (err) { message.error(String(err)); }
  };

  const testScript = async (scriptId: string) => {
    setActionLoading(scriptId);
    try {
      await api.post(`/scripts/${scriptId}/test`);
      message.success('Test triggered');
    } catch (err) { message.error(String(err)); }
    finally { setActionLoading(null); }
  };

  const cloneScript = async (scriptId: string) => {
    setActionLoading(scriptId);
    try {
      await api.post(`/scripts/${scriptId}/clone`);
      message.success('Script duplicated');
      fetchScripts();
    } catch (err) { message.error(String(err)); }
    finally { setActionLoading(null); }
  };

  const deleteScript = async (scriptId: string) => {
    try {
      await api.delete(`/scripts/${scriptId}`);
      message.success('Script deleted');
      setSelectedKeys((keys) => keys.filter((k) => k !== scriptId));
      fetchScripts();
    } catch (err) { message.error(String(err)); }
  };

  const bulkAction = async (action: 'enable' | 'disable' | 'delete') => {
    if (selectedKeys.length === 0) return;
    setBulkLoading(true);
    try {
      const results = await api.post<{ id: string; status: string; error?: string }[]>('/bulk/scripts', { ids: selectedKeys, action });
      const failed = results.filter((r) => r.status === 'error');
      if (failed.length > 0) message.error(`${failed.length} script(s) failed: ${failed.map((r) => r.error).join(', ')}`);
      else message.success(`${selectedKeys.length} script(s) ${action === 'delete' ? 'deleted' : action === 'enable' ? 'enabled' : 'disabled'}`);
      setSelectedKeys([]);
      fetchScripts();
    } catch (err) { message.error(String(err)); }
    finally { setBulkLoading(false); }
  };

  const openEdit = (script: ScriptRow) => {
    setEditing(script);
    setConfigText(JSON.stringify(script.config ?? {}, null, 2));
    editForm.setFieldsValue({ name: script.name, trigger: script.trigger, enabled: script.enabled });
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
    } catch (err) { message.error(String(err)); }
    finally { setSaving(false); }
  };

  const triggers = [...new Set(scripts.map((s) => s.trigger))];

  const visibleScripts = scripts.filter((s) => {
    if (botFilter && s.bot?.id !== botFilter) return false;
    if (triggerFilter && s.trigger !== triggerFilter) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Bot', key: 'bot', render: (_: unknown, record: ScriptRow) => (record.bot ? <Space size={4}>{record.bot.name}<Tag>{record.bot.platform}</Tag></Space> : <Tag>—</Tag>) },
    { title: 'Trigger', dataIndex: 'trigger', key: 'trigger', render: (t: string) => <Tag color={triggerColors[t]}>{t}</Tag> },
    { title: 'Enabled', dataIndex: 'enabled', key: 'enabled', render: (e: boolean, record: ScriptRow) => <SwitchRender record={record} checked={e} onToggle={toggleScript} /> },
    { title: 'Created', dataIndex: 'createdAt', key: 'createdAt', render: (t: string) => new Date(t).toLocaleString() },
    {
      title: 'Actions', key: 'actions', width: 260,
      render: (_: unknown, record: ScriptRow) => (
        <Space>
          <Button size="small" icon={<ThunderboltOutlined />} loading={actionLoading === record.id} onClick={() => testScript(record.id)}>Test</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>Edit</Button>
          <Button size="small" icon={<CopyOutlined />} loading={actionLoading === record.id} onClick={() => cloneScript(record.id)}>Copy</Button>
          <Popconfirm title="Delete this script?" onConfirm={() => deleteScript(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (error) return <Alert type="error" message={error} />;

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button icon={<ReloadOutlined />} onClick={fetchScripts}>Refresh</Button>
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
      </Space>
      <Space style={{ marginBottom: 16 }}>
        <Button size="small" icon={<PlayCircleOutlined />} disabled={selectedKeys.length === 0} loading={bulkLoading} onClick={() => bulkAction('enable')}>Enable</Button>
        <Button size="small" icon={<PauseCircleOutlined />} disabled={selectedKeys.length === 0} loading={bulkLoading} onClick={() => bulkAction('disable')}>Disable</Button>
        <Button size="small" danger icon={<DeleteOutlined />} disabled={selectedKeys.length === 0} loading={bulkLoading} onClick={() => bulkAction('delete')}>Delete</Button>
        <span style={{ color: '#888' }}>{selectedKeys.length > 0 ? `${selectedKeys.length} selected` : ''}</span>
      </Space>
      <Table
        dataSource={visibleScripts}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20 }}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
      />
      <Modal
        title={`Edit script — ${editing?.name ?? ''}`}
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
            <Input.TextArea rows={10} value={configText} onChange={(e) => setConfigText(e.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function SwitchRender({ checked, record, onToggle }: { checked: boolean; record: ScriptRow; onToggle: (id: string, enabled: boolean) => void }) {
  return <Switch checked={checked} onChange={(v) => onToggle(record.id, v)} />;
}

export default Scripts;
