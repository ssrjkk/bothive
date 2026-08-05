import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Spin, Alert, Empty, Badge, Typography, Space, theme } from 'antd';
import { RobotOutlined, CheckCircleOutlined, CodeOutlined, ApiOutlined, WarningOutlined, ApiFilled } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';

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

const statusColors: Record<string, string> = {
  running: 'green', idle: 'default', paused: 'orange', error: 'red', connecting: 'blue',
};

const levelColors: Record<string, string> = {
  info: 'blue', warn: 'orange', error: 'red', debug: 'default',
};

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

  const platformData = stats.byPlatform.map((p) => ({ name: p.platform, bots: p._count.id }));
  const aliveWorkers = workers.filter((w) => w.alive).length;

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} lg={4}><Card><Statistic title="Total Bots" value={stats.totalBots} prefix={<RobotOutlined />} /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card><Statistic title="Active" value={stats.activeBots} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card><Statistic title="Accounts" value={stats.totalAccounts} /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card><Statistic title="Scripts" value={stats.totalScripts} suffix={`/ ${stats.enabledScripts} on`} prefix={<CodeOutlined />} /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card><Statistic title="Webhooks" value={stats.totalWebhooks} suffix={`/ ${stats.enabledWebhooks} on`} prefix={<ApiOutlined />} /></Card></Col>
        <Col xs={12} sm={8} lg={4}><Card><Statistic title="Errors (24h)" value={stats.errors24h} prefix={<WarningOutlined />} valueStyle={{ color: stats.errors24h > 0 ? '#cf1322' : '#3f8600' }} /></Card></Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card title="Bots by Platform">
            {platformData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No bots yet" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={platformData}>
                  <CartesianGrid stroke={token.colorBorderSecondary} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: token.colorTextSecondary }} />
                  <YAxis tick={{ fill: token.colorTextSecondary }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="bots" fill={token.colorPrimary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Bots by Status">
            {stats.byStatus.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No bots yet" />
            ) : (
              <Table dataSource={stats.byStatus} columns={[
                { title: 'Status', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={statusColors[s]}>{s}</Tag> },
                { title: 'Count', dataIndex: '_count', key: '_count', render: (c: { id: number }) => c.id },
              ]} pagination={false} rowKey="status" />
            )}
          </Card>
        </Col>
      </Row>
      <Card
        title={<span><ApiFilled /> Workers</span>}
        style={{ marginBottom: 24 }}
        extra={<Badge status={aliveWorkers === workers.length && workers.length > 0 ? 'success' : 'warning'} text={`${aliveWorkers}/${workers.length} online`} />}
      >
        {workers.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Worker status unavailable" />
        ) : (
          <Row gutter={[16, 16]}>
            {workers.map((w) => (
              <Col xs={12} sm={6} key={w.platform}>
                <Card size="small">
                  <Space direction="vertical" size={4}>
                    <Space>
                      <Badge status={w.alive ? 'success' : 'error'} />
                      <Typography.Text strong>{w.platform}</Typography.Text>
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {w.alive ? 'online' : w.lastSeen ? `down · last seen ${new Date(w.lastSeen).toLocaleString()}` : 'never seen'}
                    </Typography.Text>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>
      <Card title="Recent Activity">
        {logs.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No activity yet" />
        ) : (
          <Table
            dataSource={logs}
            rowKey="id"
            pagination={false}
            size="small"
            columns={[
              { title: 'Time', dataIndex: 'createdAt', key: 'time', render: (t: string) => new Date(t).toLocaleString() },
              { title: 'Level', dataIndex: 'level', key: 'level', render: (l: string) => <Tag color={levelColors[l]}>{l}</Tag> },
              { title: 'Bot', dataIndex: 'botId', key: 'bot', render: (id: string) => <Tag>{id}</Tag> },
              { title: 'Message', dataIndex: 'message', key: 'message', ellipsis: true },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

export default Dashboard;
