import React, { useEffect, useRef, useState } from 'react';
import { Table, Select, Space, Alert, Button, Switch, Badge, Input, message, Card, Typography, theme } from 'antd';
import { ReloadOutlined, DownloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { api, BASE } from '../api';
import { PageHeader } from '../components/PageHeader';
import { LevelTag } from '../components/meta';

interface LogEntry {
  id: string; botId: string; level: string; message: string;
  meta: Record<string, unknown> | null; createdAt: string;
}

interface WsMessage {
  type: 'log' | 'status' | 'error';
  data: LogEntry | { connected: boolean; listeners?: number } | { message: string };
}

interface BotRef {
  id: string;
  name: string;
}

function Logs() {
  const { token } = theme.useToken();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [bots, setBots] = useState<BotRef[]>([]);
  const [live, setLive] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<string | undefined>(undefined);
  const [botFilter, setBotFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  const fetchLogs = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (levelFilter) params.set('level', levelFilter);
    if (botFilter) params.set('botId', botFilter);
    params.set('limit', '100');

    api.get<{ logs: LogEntry[]; total: number }>(`/logs?${params}`)
      .then((data) => setLogs(data.logs ?? []))
      .catch(setError)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get<BotRef[]>('/bots').then(setBots).catch(() => setBots([]));
  }, []);

  useEffect(fetchLogs, [levelFilter, botFilter]);

  const exportLogs = async () => {
    const params = new URLSearchParams();
    if (levelFilter) params.set('level', levelFilter);
    if (botFilter) params.set('botId', botFilter);
    try {
      const res = await fetch(`${BASE}/logs/export?${params}`);
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bothive-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { message.error(String(err)); }
  };

  useEffect(() => {
    if (!live) {
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/logs`);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as WsMessage;
        if (message.type === 'log') {
          const entry = message.data as LogEntry;
          setLogs((prev) => {
            if (prev.some((l) => l.id === entry.id)) return prev;
            return [entry, ...prev].slice(0, 200);
          });
        }
      } catch { /* ignore malformed frames */ }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setWsConnected(false);
    };
  }, [live]);

  if (error) return <Alert type="error" message={error} />;

  const visibleLogs = (levelFilter ? logs.filter((l) => l.level === levelFilter) : logs)
    .filter((l) => !search || l.message.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Logs"
        description="Stream and inspect activity across every bot"
        extra={
          <>
            <Select style={{ width: 150 }} placeholder="Filter by level" allowClear value={levelFilter} onChange={setLevelFilter}
              options={[{ value: 'info', label: 'Info' }, { value: 'warn', label: 'Warning' }, { value: 'error', label: 'Error' }, { value: 'debug', label: 'Debug' }]}
            />
            <Select
              style={{ width: 200 }}
              placeholder="Filter by bot"
              allowClear
              showSearch
              optionFilterProp="label"
              value={botFilter}
              onChange={setBotFilter}
              options={bots.map((b) => ({ value: b.id, label: `${b.name} (${b.id})` }))}
            />
            <Input.Search allowClear placeholder="Search messages" style={{ width: 240 }} onChange={(e) => setSearch(e.target.value)} />
            <Button icon={<ReloadOutlined />} onClick={fetchLogs}>Refresh</Button>
            <Button icon={<DownloadOutlined />} onClick={exportLogs}>Export CSV</Button>
          </>
        }
      />
      <Card
        className="bh-card"
        variant="borderless"
        title={<Space><FileTextOutlined style={{ color: token.colorPrimary }} /> Log stream</Space>}
        extra={
          <Space>
            <Badge status={wsConnected ? 'success' : 'default'} text={wsConnected ? 'Live' : 'Offline'} />
            <Typography.Text type="secondary">Live</Typography.Text>
            <Switch checked={live} onChange={setLive} />
          </Space>
        }
      >
        <Table dataSource={visibleLogs} columns={[
          { title: 'Time', dataIndex: 'createdAt', key: 'createdAt', render: (t: string) => <Typography.Text type="secondary" style={{ fontSize: 13 }}>{new Date(t).toLocaleString()}</Typography.Text>, width: 190 },
          { title: 'Bot ID', dataIndex: 'botId', key: 'botId', width: 210, ellipsis: true, render: (id: string) => <Typography.Text code style={{ fontSize: 12.5 }}>{id}</Typography.Text> },
          { title: 'Level', dataIndex: 'level', key: 'level', render: (l: string) => <LevelTag level={l} />, width: 110 },
          { title: 'Message', dataIndex: 'message', key: 'message' },
        ]} rowKey="id" loading={loading} pagination={{ pageSize: 50 }} size="middle" sticky />
      </Card>
    </div>
  );
}

export default Logs;
