import React, { useEffect, useRef, useState } from 'react';
import { Card, Col, Row, Statistic, Button, Spin, Alert, Space, Switch, Table, Empty, Typography, Tag, theme } from 'antd';
import { ReloadOutlined, BarChartOutlined } from '@ant-design/icons';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ErrorState } from '../components/ErrorState';
import { CountUp } from '../components/CountUp';
import { PlatformTag } from '../components/meta';

interface QueueMetrics {
  platform: string; waiting: number; active: number; completed: number; failed: number; delayed: number;
}

interface FailedJob {
  id: string;
  platform: string;
  name: string;
  type: string | null;
  botId: string | null;
  attemptsMade: number;
  failedReason: string | null;
  timestamp: number;
}

function Queues() {
  const { token } = theme.useToken();
  const [queues, setQueues] = useState<QueueMetrics[]>([]);
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const hasDataRef = useRef(false);

  const fetchAll = () => {
    setLoading(true);
    Promise.all([api.get<QueueMetrics[]>('/queues'), api.get<FailedJob[]>('/queues/failed')])
      .then(([queuesData, failedData]) => {
        setQueues(queuesData);
        setFailedJobs(failedData);
        setError(null);
        hasDataRef.current = true;
      })
      .catch((e) => {
        if (!hasDataRef.current) setError(String(e));
      })
      .finally(() => setLoading(false));
  };

  useEffect(fetchAll, []);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(fetchAll, 10_000);
    return () => clearInterval(timer);
  }, [auto]);

  if (error) return <ErrorState error={error} onRetry={fetchAll} />;

  const total = queues.reduce(
    (acc, q) => ({
      waiting: acc.waiting + q.waiting,
      active: acc.active + q.active,
      completed: acc.completed + q.completed,
      failed: acc.failed + q.failed,
      delayed: acc.delayed + q.delayed,
    }),
    { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
  );

  const failedTotal = failedJobs.length;

  const summaryCards = [
    { title: 'Total waiting', value: total.waiting, color: token.colorText },
    { title: 'Total active', value: total.active, color: token.colorText },
    { title: 'Total completed', value: total.completed, color: token.colorText },
    { title: 'Total failed', value: total.failed, color: total.failed > 0 ? '#ef4444' : token.colorText },
    { title: 'Total delayed', value: total.delayed, color: token.colorText },
  ];

  return (
    <div>
      <PageHeader
        title="Queues"
        description="BullMQ job throughput and failures per platform"
        extra={
          <>
            <Button icon={<ReloadOutlined />} onClick={fetchAll}>Refresh</Button>
            <Space><Typography.Text type="secondary">Auto-refresh (10s)</Typography.Text><Switch checked={auto} onChange={setAuto} /></Space>
          </>
        }
      />
      <Spin spinning={loading}>
        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          {queues.map((q) => (
            <Col xs={24} sm={12} xl={6} key={q.platform}>
              <Card
                className="bh-card"
                title={<PlatformTag platform={q.platform} />}
                extra={q.waiting + q.active > 0 ? <Tag color="processing">busy</Tag> : undefined}
              >
                <Row gutter={[8, 8]}>
                  <Col span={12}><Statistic title="Waiting" value={q.waiting} formatter={(v) => <CountUp value={Number(v)} />} valueStyle={{ fontSize: 20 }} /></Col>
                  <Col span={12}><Statistic title="Active" value={q.active} formatter={(v) => <CountUp value={Number(v)} />} valueStyle={{ fontSize: 20 }} /></Col>
                  <Col span={12}><Statistic title="Completed" value={q.completed} formatter={(v) => <CountUp value={Number(v)} />} valueStyle={{ fontSize: 20 }} /></Col>
                  <Col span={12}><Statistic title="Delayed" value={q.delayed} formatter={(v) => <CountUp value={Number(v)} />} valueStyle={{ fontSize: 20 }} /></Col>
                </Row>
                {q.failed > 0 && <div style={{ marginTop: 12 }}><Tag color="error" style={{ borderRadius: 999 }}>{q.failed} failed</Tag></div>}
              </Card>
            </Col>
          ))}
          {queues.length === 0 && !loading && (
            <Col span={24}><Alert type="info" showIcon message="No queue metrics available" /></Col>
          )}
        </Row>

        <Card className="bh-card" title={<span style={{ fontWeight: 700 }}>Summary</span>} style={{ marginBottom: 20 }}>
          <Row gutter={[16, 16]}>
            {summaryCards.map((c) => (
              <Col xs={12} sm={12} lg={4} key={c.title}><Statistic title={c.title} value={c.value} formatter={(v) => <CountUp value={Number(v)} />} valueStyle={{ fontSize: 22, fontWeight: 700, color: c.color }} /></Col>
            ))}
          </Row>
        </Card>

        <Card
          className="bh-card"
          title={<span style={{ fontWeight: 700 }}><BarChartOutlined style={{ marginRight: 8, color: token.colorPrimary }} />Failed Jobs ({failedTotal})</span>}
          extra={failedTotal > 0 && <Tag color="error" style={{ borderRadius: 999 }}>{failedTotal} need attention</Tag>}
        >
          {failedTotal === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No failed jobs — all queues healthy" />
          ) : (
            <Table
              dataSource={failedJobs}
              rowKey="id"
              size="middle"
              pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} job${t === 1 ? '' : 's'}` }}
              columns={[
                { title: 'Time', dataIndex: 'timestamp', key: 'time', render: (t: number) => <Typography.Text type="secondary" style={{ fontSize: 13 }}>{new Date(t).toLocaleString()}</Typography.Text> },
                { title: 'Platform', dataIndex: 'platform', key: 'platform', render: (p: string) => <PlatformTag platform={p} /> },
                { title: 'Job', dataIndex: 'name', key: 'name', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
                { title: 'Type', dataIndex: 'type', key: 'type', render: (t: string | null) => t ? <Tag color="processing" style={{ borderRadius: 999 }}>{t}</Tag> : '—' },
                { title: 'Bot', dataIndex: 'botId', key: 'bot', render: (id: string | null) => id ? <Typography.Text code style={{ fontSize: 12.5 }}>{id}</Typography.Text> : '—' },
                { title: 'Attempts', dataIndex: 'attemptsMade', key: 'attempts', width: 90 },
                { title: 'Reason', dataIndex: 'failedReason', key: 'reason', ellipsis: true },
              ]}
            />
          )}
        </Card>
      </Spin>
    </div>
  );
}

export default Queues;
