import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Table, Spin, Alert, Empty, Badge, Typography, Space, Progress, Tag, theme } from 'antd';
import { RobotOutlined, CheckCircleOutlined, CodeOutlined, ApiOutlined, WarningOutlined, TeamOutlined } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api } from '../api';
import { LevelTag, PlatformTag, platformHex, STATUS_META } from '../components/meta';interface Stats {
  totalBots: number;
  activeBots: number;
  totalAccounts: number;
  recentLogs24h: number;
  errors24h: number;
  totalScripts: number;
  enabledScripts: number;
  totalWebhooks: number;
  enabledWebhooks: number;
  byPlatform: { platform: string; _count: { id: number } }[];
  byStatus: { status: string; _count: { id: number } }[];
}

interface LogEntry {
  id: string;
  botId: string;
  level: string;
  message: string;
  createdAt: string;
}

interface WorkerHealth {
  platform: string;
  alive: boolean;
  lastSeen: string | null;
}

const statCards = (stats: Stats) => [
  { title: 'Total Bots', value: stats.totalBots, icon: <RobotOutlined />, color: '#6d5dfc', tint: 'rgba(109,93,252,0.14)' },
  { title: 'Active Now', value: stats.activeBots, icon: <CheckCircleOutlined />, color: '#16a34a', tint: 'rgba(22,163,74,0.14)' },
  { title: 'Accounts', value: stats.totalAccounts, icon: <TeamOutlined />, color: '#0ea5e9', tint: 'rgba(14,165,233,0.14)' },
  { title: 'Scripts', value: stats.totalScripts, suffix: `/ ${stats.enabledScripts} on`, icon: <CodeOutlined />, color: '#a855f7', tint: 'rgba(168,85,247,0.14)' },
  { title: 'Webhooks', value: stats.totalWebhooks, suffix: `/ ${stats.enabledWebhooks} on`, icon: <ApiOutlined />, color: '#f59e0b', tint: 'rgba(245,158,11,0.16)' },
  { title: 'Errors (24h)', value: stats.errors24h, icon: <WarningOutlined />, color: stats.errors24h > 0 ? '#ef4444' : '#16a34a', tint: stats.errors24h > 0 ? 'rgba(239,68,68,0.14)' : 'rgba(22,163,74,0.14)' },
];

function StatCard({ card }: { card: ReturnType<typeof statCards>[number] }) {
  const { token } = theme.useToken();
  return (
    <Card className="bh-stat-card bh-card" variant="borderless">
      <div className="bh-stat-tint" style={{ background: card.tint }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="bh-stat-icon" style={{ background: card.tint, color: card.color }}>{card.icon}</div>
        <Statistic
          title={card.title}
          value={card.value}
          suffix={card.suffix}
          valueStyle={{ fontSize: 24, fontWeight: 700, color: token.colorText }}
        />
      </div>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value?: number; payload?: { color?: string } }[]; label?: string }) {
  const { token } = theme.useToken();
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 10, padding: '8px 12px', boxShadow: token.boxShadowTertiary }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <span className="bh-dot" style={{ background: payload[0].payload?.color ?? token.colorPrimary, marginRight: 6 }} />
      <span>{payload[0].value}</span>
    </div>
  );
}

function Dashboard() {
  const { token } = theme.useToken();
  const [stats, setStats] = useState<Stats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [workers, setWorkers] = useState<WorkerHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = () => {
    Promise.all([
      api.get<Stats>('/stats'),
      api.get<{ logs: LogEntry[] }>('/logs?limit=12').then((res) => res.logs),
      api.get<WorkerHealth[]>('/health/workers'),
    ])
      .then(([statsData, logsData, workersData]) => {
        setStats(statsData);
        setLogs(logsData);
        setWorkers(workersData);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 15_000);
    return () => clearInterval(timer);
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert type="error" message={error} />;
  if (!stats) return null;

  const platformData = stats.byPlatform.map((p) => ({ name: p.platform, bots: p._count.id, color: platformHex(p.platform) }));
  const statusData = stats.byStatus.map((s) => ({ status: s.status, count: s._count.id }));
  const totalForStatus = statusData.reduce((acc, s) => acc + s.count, 0);
  const aliveWorkers = workers.filter((w) => w.alive).length;

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        {statCards(stats).map((card) => (
          <Col xs={12} sm={8} lg={4} key={card.title}><StatCard card={card} /></Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={14}>
          <Card className="bh-card" title={<span style={{ fontWeight: 700 }}>Bots by Platform</span>}>
            {platformData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No bots yet" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={platformData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#9b6bff" />
                      <stop offset="100%" stopColor="#6d5dfc" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={token.colorBorderSecondary} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: token.colorTextSecondary }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: token.colorTextSecondary }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: token.colorFillTertiary }} />
                  <Bar dataKey="bots" fill="url(#barGrad)" radius={[8, 8, 0, 0]} maxBarSize={54}>
                    {platformData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card className="bh-card" title={<span style={{ fontWeight: 700 }}>Bots by Status</span>}>
            {statusData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No bots yet" />
            ) : (
              <Space direction="vertical" size={14} style={{ width: '100%', paddingTop: 8 }}>
                {statusData.map((s) => {
                  const meta = STATUS_META[s.status] ?? { color: '#94a3b8' };
                  const pct = totalForStatus > 0 ? Math.round((s.count / totalForStatus) * 100) : 0;
                  return (
                    <div key={s.status}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{s.status}</span>
                        <span style={{ color: token.colorTextSecondary }}>{s.count}</span>
                      </div>
                      <Progress percent={pct} showInfo={false} strokeColor={meta.color} trailColor={token.colorFillTertiary} size="small" />
                    </div>
                  );
                })}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Card
        className="bh-card"
        title={<span style={{ fontWeight: 700 }}><ApiOutlined style={{ marginRight: 8, color: token.colorPrimary }} />Workers</span>}
        style={{ marginBottom: 20 }}
        extra={<Badge status={aliveWorkers === workers.length && workers.length > 0 ? 'success' : 'warning'} text={`${aliveWorkers}/${workers.length} online`} />}
      >
        {workers.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Worker status unavailable" />
        ) : (
          <Row gutter={[16, 16]}>
            {workers.map((w) => {
              const color = platformHex(w.platform);
              return (
                <Col xs={12} sm={6} key={w.platform}>
                  <Card size="small" className="bh-card" variant="borderless" style={{ border: `1px solid ${w.alive ? 'transparent' : token.colorBorderSecondary}` }}>
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <PlatformTag platform={w.platform} />
                        <span className={`bh-dot ${w.alive ? 'bh-dot--pulse' : ''}`} style={{ background: w.alive ? '#16a34a' : color }} />
                      </Space>
                      <Typography.Text style={{ fontSize: 12, color: w.alive ? token.colorTextSecondary : token.colorError }}>
                        {w.alive ? 'online' : w.lastSeen ? `down · ${new Date(w.lastSeen).toLocaleString()}` : 'never seen'}
                      </Typography.Text>
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Card>

      <Card className="bh-card" title={<span style={{ fontWeight: 700 }}>Recent Activity</span>}>
        {logs.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No activity yet" />
        ) : (
          <Table
            dataSource={logs}
            rowKey="id"
            pagination={false}
            size="middle"
            columns={[
              { title: 'Time', dataIndex: 'createdAt', key: 'time', width: 190, render: (t: string) => <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>{new Date(t).toLocaleString()}</span> },
              { title: 'Level', dataIndex: 'level', key: 'level', width: 110, render: (l: string) => <LevelTag level={l} /> },
              { title: 'Bot', dataIndex: 'botId', key: 'bot', width: 200, render: (id: string) => <Tag style={{ borderRadius: 999 }}>{id}</Tag> },
              { title: 'Message', dataIndex: 'message', key: 'message', ellipsis: true },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

export default Dashboard;
