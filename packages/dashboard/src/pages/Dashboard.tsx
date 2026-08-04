import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Spin, Alert } from 'antd';
import { RobotOutlined, CheckCircleOutlined, FileTextOutlined, CodeOutlined, ApiOutlined, WarningOutlined } from '@ant-design/icons';
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

const statusColors: Record<string, string> = {
  running: 'green', idle: 'default', paused: 'orange', error: 'red', connecting: 'blue',
};

const levelColors: Record<string, string> = {
  info: 'blue', warn: 'orange', error: 'red', debug: 'default',
};

function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Stats>('/stats')
      .then(setStats)
      .catch(setError)
      .then(() => api.get<{ logs: LogEntry[] }>('/logs?limit=12'))
      .then((res) => setLogs(res.logs))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert type="error" message={error} />;
  if (!stats) return null;

  const platformData = stats.byPlatform.map((p) => ({ name: p.platform, bots: p._count.id }));

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}><Card><Statistic title="Total Bots" value={stats.totalBots} prefix={<RobotOutlined />} /></Card></Col>
        <Col span={4}><Card><Statistic title="Active" value={stats.activeBots} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col span={4}><Card><Statistic title="Accounts" value={stats.totalAccounts} /></Card></Col>
        <Col span={4}><Card><Statistic title="Scripts" value={stats.totalScripts} suffix={`/ ${stats.enabledScripts} on`} prefix={<CodeOutlined />} /></Card></Col>
        <Col span={4}><Card><Statistic title="Webhooks" value={stats.totalWebhooks} suffix={`/ ${stats.enabledWebhooks} on`} prefix={<ApiOutlined />} /></Card></Col>
        <Col span={4}><Card><Statistic title="Errors (24h)" value={stats.errors24h} prefix={<WarningOutlined />} valueStyle={{ color: stats.errors24h > 0 ? '#cf1322' : '#3f8600' }} /></Card></Col>
      </Row>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="Bots by Platform">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={platformData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" /><YAxis /><Tooltip />
                <Bar dataKey="bots" fill="#1677ff" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="Bots by Status">
            <Table dataSource={stats.byStatus} columns={[
              { title: 'Status', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={statusColors[s]}>{s}</Tag> },
              { title: 'Count', dataIndex: '_count', key: '_count', render: (c: { id: number }) => c.id },
            ]} pagination={false} rowKey="status" />
          </Card>
        </Col>
      </Row>
      <Card title="Recent Activity">
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
      </Card>
    </div>
  );
}

export default Dashboard;
