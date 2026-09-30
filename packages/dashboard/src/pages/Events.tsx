import React, { useState } from 'react';
import {
  Card,
  Table,
  Tag,
  Typography,
  Button,
  Space,
  Drawer,
  Descriptions,
  Select,
  Popconfirm,
  Empty,
  message,
  Statistic,
  Row,
  Col,
  theme,
} from 'antd';
import {
  ReloadOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  HistoryOutlined,
  DatabaseOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { api, BASE } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ErrorState } from '../components/ErrorState';
import { CountUp } from '../components/CountUp';
import { PlatformTag, PLATFORMS, TRIGGER_TAGS, platformHex } from '../components/meta';
import { useApiResource } from '../hooks/useApiResource';

interface EventRecord {
  id: string;
  botId: string;
  platform: string;
  type: string;
  version: number;
  eventId: string;
  payload: Record<string, unknown>;
  replayCount: number;
  lastReplayedAt: string | null;
  createdAt: string;
}

interface EventStats {
  total: number;
  replayed: number;
  byType: { type: string; count: number }[];
  byPlatform: { platform: string; count: number }[];
}

const EVENT_TYPES = [
  'message',
  'follow',
  'subscribe',
  'donation',
  'comment',
  'raid',
  'host',
  'price',
  'signal',
  'trade',
  'interval',
  'error',
];

/** Simple JSON renderer with colored keys/strings for the payload drawer. */
function JsonView({ value }: { value: unknown }) {
  const { token } = theme.useToken();
  const indent = (depth: number) => ({ paddingLeft: depth * 16 });

  const render = (v: unknown, depth: number): React.ReactNode => {
    if (v === null || v === undefined) {
      return <span style={{ color: token.colorTextTertiary }}>{String(v)}</span>;
    }
    if (typeof v === 'string') {
      return <span style={{ color: '#16a34a' }}>"{v}"</span>;
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      return <span style={{ color: '#f59e0b' }}>{String(v)}</span>;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) return <span style={{ color: token.colorTextTertiary }}>[]</span>;
      return (
        <span>
          <span style={{ color: token.colorTextSecondary }}>[</span>
          <div style={indent(depth)}>
            {v.map((item, i) => (
              <div key={i}>
                {render(item, depth + 1)}
                {i < v.length - 1 ? ',' : ''}
              </div>
            ))}
          </div>
          <span style={{ color: token.colorTextSecondary }}>]</span>
        </span>
      );
    }
    if (typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length === 0)
        return <span style={{ color: token.colorTextTertiary }}>{'{}'}</span>;
      return (
        <span>
          <span style={{ color: token.colorTextSecondary }}>{'{'}</span>
          <div style={indent(depth)}>
            {entries.map(([k, item], i) => (
              <div key={k}>
                <span style={{ color: '#6d5dfc' }}>"{k}"</span>
                <span style={{ color: token.colorTextTertiary }}>: </span>
                {render(item, depth + 1)}
                {i < entries.length - 1 ? ',' : ''}
              </div>
            ))}
          </div>
          <span style={{ color: token.colorTextSecondary }}>{'}'}</span>
        </span>
      );
    }
    return String(v);
  };

  return (
    <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 }}>
      {render(value, 1)}
    </div>
  );
}

function Events() {
  const { token } = theme.useToken();
  const [platform, setPlatform] = useState<string | undefined>();
  const [type, setType] = useState<string | undefined>();
  const [detail, setDetail] = useState<EventRecord | null>(null);

  const data = useApiResource(
    async () => {
      const params = new URLSearchParams();
      if (platform) params.set('platform', platform);
      if (type) params.set('type', type);
      const qs = params.toString();
      // The api wrapper returns only `data`; the store also reports `total`
      // (all matching events, before pagination), so fetch the raw envelope.
      const [listRes, stats] = await Promise.all([
        fetch(`${BASE}/events${qs ? `?${qs}` : ''}`),
        api.get<EventStats>('/events/stats'),
      ]);
      const json = (await listRes.json()) as { data?: EventRecord[]; total?: number };
      if (!listRes.ok)
        throw new Error(
          (json as { error?: { message?: string } }).error?.message ?? 'Failed to load events',
        );
      return {
        events: json.data ?? [],
        total: json.total ?? json.data?.length ?? 0,
        stats,
      };
    },
    { deps: [platform, type] },
  );

  const events = data.data?.events ?? [];
  const total = data.data?.total ?? events.length;
  const stats = data.data?.stats;
  const replayed = stats?.replayed ?? events.filter((e) => e.replayCount > 0).length;
  const typeCounts = new Map<string, number>();
  for (const e of events) typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
  const platformCounts = new Map<string, number>();
  for (const e of events) platformCounts.set(e.platform, (platformCounts.get(e.platform) ?? 0) + 1);

  const replay = async (record: EventRecord) => {
    try {
      await api.post(`/events/${record.id}/replay`);
      message.success(`Event ${record.type} queued for replay`);
      data.reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Replay failed');
    }
  };

  const remove = async (record: EventRecord) => {
    try {
      await api.delete(`/events/${record.id}`);
      message.success('Event deleted');
      data.reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;

  return (
    <div>
      <PageHeader
        title="Events"
        description="Stored platform events — inspect history and replay into scripts/webhooks"
        extra={
          <Button icon={<ReloadOutlined />} onClick={data.reload}>
            Refresh
          </Button>
        }
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} lg={6}>
          <Card className="bh-card bh-card--lift" variant="borderless">
            <Statistic
              title="Events stored"
              value={stats?.total ?? total}
              formatter={(v) => <CountUp value={Number(v)} />}
              prefix={<DatabaseOutlined style={{ color: '#0d9488' }} />}
              valueStyle={{ fontSize: 24, fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={6}>
          <Card className="bh-card bh-card--lift" variant="borderless">
            <Statistic
              title="Replayed"
              value={replayed}
              formatter={(v) => <CountUp value={Number(v)} />}
              prefix={<HistoryOutlined style={{ color: '#f59e0b' }} />}
              valueStyle={{ fontSize: 24, fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8} lg={12}>
          <Card className="bh-card" variant="borderless" bodyStyle={{ padding: '14px 16px' }}>
            <Space wrap>
              <Select
                allowClear
                placeholder="Platform"
                style={{ width: 150 }}
                value={platform}
                onChange={setPlatform}
                options={PLATFORMS.map((p) => ({ value: p, label: p }))}
              />
              <Select
                allowClear
                placeholder="Event type"
                style={{ width: 170 }}
                value={type}
                onChange={setType}
                options={EVENT_TYPES.map((t) => ({ value: t, label: t }))}
              />
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {events.length < total
                  ? `showing ${events.length} of ${total}`
                  : `${total} event${total === 1 ? '' : 's'}`}
              </Typography.Text>
            </Space>
          </Card>
        </Col>
      </Row>

      {stats && stats.byType.length > 0 && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} lg={14}>
            <Card
              className="bh-card bh-card--lift"
              variant="borderless"
              title={
                <span style={{ fontWeight: 700 }}>
                  <BarChartOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
                  Event mix by type
                </span>
              }
              extra={
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  {stats.total} total
                </Typography.Text>
              }
            >
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stats.byType} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid
                    stroke={token.colorBorderSecondary}
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="type"
                    tick={{ fill: token.colorTextSecondary, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: token.colorTextSecondary }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: token.colorFillTertiary }}
                    contentStyle={{
                      borderRadius: 10,
                      border: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={42}>
                    {stats.byType.map((entry) => (
                      <Cell
                        key={entry.type}
                        fill={TRIGGER_TAGS[entry.type] ? undefined : '#6d5dfc'}
                        style={TRIGGER_TAGS[entry.type] ? { fill: `var(--bh-primary)` } : undefined}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card
              className="bh-card bh-card--lift"
              variant="borderless"
              title={
                <span style={{ fontWeight: 700 }}>
                  <BarChartOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
                  By platform
                </span>
              }
            >
              <div style={{ paddingTop: 4 }}>
                {stats.byPlatform.map((p) => (
                  <div
                    key={p.platform}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  >
                    <PlatformTag platform={p.platform} />
                    <Typography.Text strong>{p.count}</Typography.Text>
                  </div>
                ))}
              </div>
            </Card>
          </Col>
        </Row>
      )}

      {events.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Space wrap size={[6, 6]}>
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              In view:
            </Typography.Text>
            {[...typeCounts.entries()].map(([t, n]) => (
              <Tag
                key={t}
                color={TRIGGER_TAGS[t] ?? 'default'}
                style={{ borderRadius: 999, cursor: 'pointer' }}
                onClick={() => setType(t)}
              >
                {t} · {n}
              </Tag>
            ))}
            {platformCounts.size > 1 && (
              <>
                <Typography.Text type="secondary" style={{ fontSize: 12.5, marginLeft: 8 }}>
                  Platforms:
                </Typography.Text>
                {[...platformCounts.entries()].map(([p, n]) => (
                  <Tag
                    key={p}
                    style={{ borderRadius: 999, cursor: 'pointer' }}
                    icon={<span className="bh-dot" style={{ background: platformHex(p) }} />}
                    onClick={() => setPlatform(p)}
                  >
                    {p} · {n}
                  </Tag>
                ))}
              </>
            )}
          </Space>
        </div>
      )}

      <Card className="bh-card">
        {events.length === 0 && !data.loading ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                No events stored yet — they appear here as bots emit them.
                <br />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Use the filters above to narrow the history; replays re-run scripts and webhooks.
                </Typography.Text>
              </span>
            }
          />
        ) : (
          <Table
            dataSource={events}
            rowKey="id"
            size="middle"
            loading={data.loading}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            columns={[
              {
                title: 'Time',
                dataIndex: 'createdAt',
                key: 'time',
                render: (t: string) => (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {new Date(t).toLocaleString()}
                  </Typography.Text>
                ),
              },
              {
                title: 'Platform',
                dataIndex: 'platform',
                key: 'platform',
                render: (p: string) => <PlatformTag platform={p} />,
              },
              {
                title: 'Type',
                dataIndex: 'type',
                key: 'type',
                render: (t: string) => (
                  <Tag color={TRIGGER_TAGS[t] ?? 'default'} style={{ borderRadius: 999 }}>
                    {t}
                  </Tag>
                ),
              },
              {
                title: 'Bot',
                dataIndex: 'botId',
                key: 'bot',
                render: (id: string) => (
                  <Typography.Text code style={{ fontSize: 12.5 }}>
                    {id}
                  </Typography.Text>
                ),
              },
              {
                title: 'Contract',
                dataIndex: 'version',
                key: 'version',
                width: 90,
                render: (v: number) => <Tag color="geekblue">v{v}</Tag>,
              },
              {
                title: 'Replays',
                dataIndex: 'replayCount',
                key: 'replays',
                width: 90,
                render: (n: number) => (n > 0 ? <Tag color="gold">{n}</Tag> : '—'),
              },
              {
                title: '',
                key: 'actions',
                width: 200,
                align: 'right',
                render: (_: unknown, record: EventRecord) => (
                  <Space size={4}>
                    <Button
                      size="small"
                      type="text"
                      icon={<EyeOutlined />}
                      onClick={() => setDetail(record)}
                    >
                      View
                    </Button>
                    <Popconfirm
                      title="Replay this event?"
                      description="Scripts and webhooks will re-run for this event."
                      onConfirm={() => replay(record)}
                      okText="Replay"
                    >
                      <Button size="small" type="text" icon={<PlayCircleOutlined />}>
                        Replay
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title="Delete this stored event?"
                      onConfirm={() => remove(record)}
                      okText="Delete"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label="delete"
                      />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Drawer
        title={`Event ${detail ? detail.type : ''}`}
        width={540}
        open={detail !== null}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Id">{detail.id}</Descriptions.Item>
            <Descriptions.Item label="Bot">{detail.botId}</Descriptions.Item>
            <Descriptions.Item label="Platform">
              <PlatformTag platform={detail.platform} />
            </Descriptions.Item>
            <Descriptions.Item label="Type">
              <Tag color={TRIGGER_TAGS[detail.type] ?? 'default'} style={{ borderRadius: 999 }}>
                {detail.type}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Contract version">v{detail.version}</Descriptions.Item>
            <Descriptions.Item label="Event id">
              <Typography.Text code style={{ fontSize: 12 }}>
                {detail.eventId}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="Replays">{detail.replayCount}</Descriptions.Item>
            <Descriptions.Item label="Payload">
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: token.colorBgLayout,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  maxHeight: 340,
                  overflow: 'auto',
                  wordBreak: 'break-word',
                }}
              >
                <JsonView value={detail.payload} />
              </div>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}

export default Events;
