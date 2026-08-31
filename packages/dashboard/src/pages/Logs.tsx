import React, { useEffect, useRef, useState } from 'react';
import {
  Table,
  Select,
  Space,
  Button,
  Switch,
  Badge,
  Input,
  message,
  Card,
  Typography,
  theme,
} from 'antd';
import { ReloadOutlined, DownloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { api, BASE } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ErrorState } from '../components/ErrorState';
import { LevelTag } from '../components/meta';
import type { LogEntry, BotRef } from '../types';
import { useApiResource } from '../hooks/useApiResource';

interface WsMessage {
  type: 'log' | 'status' | 'error';
  data: LogEntry | { connected: boolean; listeners?: number } | { message: string };
}

function Logs() {
  const { token } = theme.useToken();
  const [bots, setBots] = useState<BotRef[]>([]);
  const [live, setLive] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string | undefined>(undefined);
  const [botFilter, setBotFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  const logs = useApiResource(
    () => {
      const params = new URLSearchParams();
      if (levelFilter) params.set('level', levelFilter);
      if (botFilter) params.set('botId', botFilter);
      params.set('limit', '100');
      return api
        .get<{ logs: LogEntry[]; total: number }>(`/logs?${params}`)
        .then((data) => data.logs ?? []);
    },
    { deps: [levelFilter, botFilter] },
  );

  useEffect(() => {
    api
      .get<BotRef[]>('/bots')
      .then(setBots)
      .catch(() => setBots([]));
  }, []);

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
    } catch (err) {
      message.error(String(err));
    }
  };

  const { setData: appendLog } = logs;

  useEffect(() => {
    if (!live) {
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
      return;
    }

    let disposed = false;
    let retryCount = 0;
    let retryTimer: number | undefined;
    let ws: WebSocket | null = null;

    const open = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/ws/logs`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCount = 0;
        if (!disposed) setWsConnected(true);
      };
      ws.onclose = () => {
        if (disposed) return;
        setWsConnected(false);
        // Exponential backoff reconnection (1s, 2s, 4s, ... capped at 30s) so a
        // transient network blip or server restart doesn't permanently break
        // live log streaming until the user toggles live mode.
        if (live && !disposed) {
          const delay = Math.min(1000 * 2 ** retryCount, 30_000);
          retryCount += 1;
          retryTimer = window.setTimeout(open, delay);
        }
      };
      ws.onerror = () => {
        // onclose fires after onerror; reconnection is handled there.
        if (!disposed) setWsConnected(false);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as WsMessage;
          if (message.type === 'log') {
            const entry = message.data as LogEntry;
            appendLog((prev) => {
              const current = prev ?? [];
              if (current.some((l) => l.id === entry.id)) return prev;
              return [entry, ...current].slice(0, 200);
            });
          }
        } catch {
          /* ignore malformed frames */
        }
      };
    };

    open();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      ws?.close();
      wsRef.current = null;
      setWsConnected(false);
    };
  }, [live, appendLog]);

  if (logs.error) return <ErrorState error={logs.error} onRetry={logs.reload} />;

  const visibleLogs = (logs.data ?? []).filter(
    (l) =>
      (!levelFilter || l.level === levelFilter) &&
      (!botFilter || l.botId === botFilter) &&
      (!search || l.message.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div>
      <PageHeader
        title="Logs"
        description="Stream and inspect activity across every bot"
        extra={
          <>
            <Select
              style={{ width: 150 }}
              placeholder="Filter by level"
              allowClear
              value={levelFilter}
              onChange={setLevelFilter}
              options={[
                { value: 'info', label: 'Info' },
                { value: 'warn', label: 'Warning' },
                { value: 'error', label: 'Error' },
                { value: 'debug', label: 'Debug' },
              ]}
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
            <Input.Search
              allowClear
              placeholder="Search messages"
              style={{ width: 240 }}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button icon={<ReloadOutlined />} onClick={logs.reload}>
              Refresh
            </Button>
            <Button icon={<DownloadOutlined />} onClick={exportLogs}>
              Export CSV
            </Button>
          </>
        }
      />
      <Card
        className="bh-card"
        variant="borderless"
        title={
          <Space>
            <FileTextOutlined style={{ color: token.colorPrimary }} /> Log stream
          </Space>
        }
        extra={
          <Space>
            <Badge
              status={wsConnected ? 'success' : 'default'}
              text={wsConnected ? 'Live' : 'Offline'}
            />
            <Typography.Text type="secondary">Live</Typography.Text>
            <Switch checked={live} onChange={setLive} />
          </Space>
        }
      >
        <Table
          dataSource={visibleLogs}
          columns={[
            {
              title: 'Time',
              dataIndex: 'createdAt',
              key: 'createdAt',
              render: (t: string) => (
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {new Date(t).toLocaleString()}
                </Typography.Text>
              ),
              width: 190,
            },
            {
              title: 'Bot ID',
              dataIndex: 'botId',
              key: 'botId',
              width: 210,
              ellipsis: true,
              render: (id: string) => (
                <Typography.Text code style={{ fontSize: 12.5 }}>
                  {id}
                </Typography.Text>
              ),
            },
            {
              title: 'Level',
              dataIndex: 'level',
              key: 'level',
              render: (l: string) => <LevelTag level={l} />,
              width: 110,
            },
            { title: 'Message', dataIndex: 'message', key: 'message' },
          ]}
          rowKey="id"
          loading={logs.loading}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            showTotal: (t) => `${t} log${t === 1 ? '' : 's'}`,
          }}
          size="middle"
          sticky
        />
      </Card>
    </div>
  );
}

export default Logs;
