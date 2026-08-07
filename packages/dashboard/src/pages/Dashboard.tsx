import React, { useEffect, useRef, useState } from 'react';
import { Card, Row, Col, Empty, Badge, Typography, Space, Progress, theme, Skeleton } from 'antd';
import { RobotOutlined, CheckCircleOutlined, CodeOutlined, ApiOutlined, WarningOutlined, TeamOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api } from '../api';
import { CountUp } from '../components/CountUp';
import { ErrorState } from '../components/ErrorState';
import { LevelTag, PlatformTag, platformHex, STATUS_META, LEVEL_META } from '../components/meta';

interface Stats {
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
  { title: 'Errors (24h)', value: stats.errors24h, suffix: `/ ${stats.recentLogs24h} logs`, icon: <WarningOutlined />, color: stats.errors24h > 0 ? '#ef4444' : '#16a34a', tint: stats.errors24h > 0 ? 'rgba(239,68,68,0.14)' : 'rgba(22,163,74,0.14)' },
];

function StatCard({ card }: { card: ReturnType<typeof statCards>[number] }) {
  const { token } = theme.useToken();
  return (
    <Card className="bh-stat-card bh-card" variant="borderless">
      <div className="bh-stat-tint" style={{ background: card.tint }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="bh-stat-icon" style={{ background: card.tint, color: card.color, boxShadow: `0 8px 18px ${card.tint}` }}>{card.icon}</div>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginBottom: 2 }}>{card.title}</Typography.Text>
          <span className="bh-stat-value" style={{ color: token.colorText }}>
            <CountUp value={card.value} />
            {card.suffix && <span className="bh-stat-suffix">{card.suffix}</span>}
          </span>
        </div>
      </div>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value?: number; payload?: { color?: string } }[]; label?: string }) {
  const { token } = theme.useToken();
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 10, padding: '8px 12px', boxShadow: token.boxShadowTertiary }}>
      <div style={{ fontWeight: 600, marginBottom: 2, textTransform: 'capitalize' }}>{label}</div>
      <span className="bh-dot" style={{ background: payload[0].payload?.color ?? token.colorPrimary, marginRight: 6 }} />
      <span>{payload[0].value} bot{payload[0].value === 1 ? '' : 's'}</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Skeleton.Input active size="small" style={{ width: 200, height: 13 }} />
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Col xs={12} sm={8} lg={4} key={i}>
            <Card className="bh-card" variant="borderless">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Skeleton.Avatar active size={44} shape="square" style={{ borderRadius: 12 }} />
                <div style={{ flex: 1 }}>
                  <Skeleton.Input active size="small" style={{ width: '75%', height: 11 }} />
                  <div style={{ marginTop: 7 }}>
                    <Skeleton.Input active size="small" style={{ width: '55%', height: 18 }} />
                  </div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={14}>
          <Card className="bh-card" variant="borderless" title={<Skeleton.Input active size="small" style={{ width: 160, height: 14 }} />}>
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card className="bh-card" variant="borderless" title={<Skeleton.Input active size="small" style={{ width: 160, height: 14 }} />}>
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
        </Col>
      </Row>
      <Card className="bh-card" variant="borderless" title={<Skeleton.Input active size="small" style={{ width: 160, height: 14 }} />}>
        <Skeleton active paragraph={{ rows: 3 }} />
      </Card>
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
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const hasDataRef = useRef(false);

  const fetchAll = () => {
    Promise.all([
      api.get<Stats>('/stats'),
      api.get<{ logs: LogEntry[] }>('/logs?limit=10').then((res) => res.logs),
      api.get<WorkerHealth[]>('/health/workers'),
    ])
      .then(([statsData, logsData, workersData]) => {
        setStats(statsData);
        setLogs(logsData);
        setWorkers(workersData);
        setUpdatedAt(new Date());
        setError(null);
        hasDataRef.current = true;
      })
      .catch((e) => {
        if (!hasDataRef.current) setError(String(e));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 15_000);
    return () => clearInterval(timer);
  }, []);

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorState error={error} onRetry={fetchAll} />;
  if (!stats) return null;

  const platformData = stats.byPlatform.map((p) => ({ name: p.platform, bots: p._count.id, color: platformHex(p.platform) }));
  const totalBotsByPlatform = platformData.reduce((acc, p) => acc + p.bots, 0);
  const statusData = stats.byStatus.map((s) => ({ status: s.status, count: s._count.id }));
  const totalForStatus = statusData.reduce((acc, s) => acc + s.count, 0);
  const aliveWorkers = workers.filter((w) => w.alive).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <span className="bh-live">
          <span className="bh-dot bh-dot--pulse" style={{ background: '#16a34a' }} />
          live · auto-refresh 15s · updated {updatedAt ? updatedAt.toLocaleTimeString() : '—'}
        </span>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        {statCards(stats).map((card) => (
          <Col xs={12} sm={8} lg={4} key={card.title} className="bh-stat-col"><StatCard card={card} /></Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={14}>
          <Card
            className="bh-card"
            variant="borderless"
            title={<span style={{ fontWeight: 700 }}>Bots by Platform</span>}
            extra={<Typography.Text type="secondary" style={{ fontSize: 12.5 }}>{totalBotsByPlatform} total</Typography.Text>}
          >
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
                  <XAxis dataKey="name" tick={{ fill: token.colorTextSecondary }} tickFormatter={(v: string) => v.charAt(0).toUpperCase() + v.slice(1)} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: token.colorTextSecondary }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: token.colorFillTertiary }} />
                  <Bar dataKey="bots" fill="url(#barGrad)" radius={[8, 8, 0, 0]} maxBarSize={54} animationDuration={600}>
                    {platformData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card className="bh-card" variant="borderless" title={<span style={{ fontWeight: 700 }}>Bots by Status</span>}>
            {statusData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No bots yet" />
            ) : (
              <Space direction="vertical" size={14} style={{ width: '100%', paddingTop: 8 }}>
                {statusData.map((s) => {
                  const meta = STATUS_META[s.status] ?? { color: '#94a3b8', tag: 'default' };
                  const pct = totalForStatus > 0 ? Math.round((s.count / totalForStatus) * 100) : 0;
                  return (
                    <div key={s.status}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Space size={8}>
                          <span className={`bh-dot ${meta.pulse ? 'bh-dot--pulse' : ''}`} style={{ background: meta.color }} />
                          <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{s.status}</span>
                        </Space>
                        <span style={{ color: token.colorTextSecondary }}>{s.count}</span>
                      </div>
                      <Progress percent={pct} showInfo={false} strokeColor={meta.color} trailColor={token.colorFillTertiary} strokeLinecap="round" size="small" />
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
        variant="borderless"
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
                <Col xs={12} sm={6} key={w.platform} className="bh-worker-col">
                  <Card size="small" className="bh-card bh-worker-card" variant="borderless" style={{ border: `1px solid ${w.alive ? 'rgba(22,163,74,0.25)' : token.colorBorderSecondary}` }}>
                    <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space size={10}>
                        <div className="bh-worker-avatar" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, boxShadow: `0 6px 14px ${color}44` }}>
                          {w.platform.slice(0, 1)}
                        </div>
                        <div>
                          <PlatformTag platform={w.platform} />
                          <div style={{ marginTop: 4, fontSize: 12, color: w.alive ? token.colorTextSecondary : token.colorError }}>
                            {w.alive ? 'online' : w.lastSeen ? `down · ${new Date(w.lastSeen).toLocaleString()}` : 'never seen'}
                          </div>
                        </div>
                      </Space>
                      <span className={`bh-dot ${w.alive ? 'bh-dot--pulse' : ''}`} style={{ background: w.alive ? '#16a34a' : color }} />
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Card>

      <Card
        className="bh-card"
        variant="borderless"
        title={<span style={{ fontWeight: 700 }}><ThunderboltOutlined style={{ marginRight: 8, color: token.colorPrimary }} />Recent Activity</span>}
        extra={<ButtonLink href="/logs" label="View all logs" />}
      >
        {logs.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No activity yet" />
        ) : (
          <div className="bh-feed">
            {logs.map((log) => {
              const meta = LEVEL_META[log.level] ?? { color: '#94a3b8' };
              return (
                <div className="bh-feed-item" key={log.id}>
                  <span className="bh-feed-rail" style={{ background: meta.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bh-feed-msg">{log.message}</div>
                    <div className="bh-feed-meta">
                      <LevelTag level={log.level} /> · <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{log.botId}</span> · {new Date(log.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function ButtonLink({ href, label }: { href: string; label: string }) {
  return (
    <Typography.Link href={href} style={{ fontSize: 12.5 }}>{label}</Typography.Link>
  );
}

export default Dashboard;
