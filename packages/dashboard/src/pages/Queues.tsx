import React, { useEffect, useState } from 'react';
import { Card, Col, Row, Statistic, Tag, Button, Spin, Alert, Space, Switch, Table, Empty } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';

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
  const [queues, setQueues] = useState<QueueMetrics[]>([]);
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);

  const fetchAll = () => {
    setLoading(true);
    Promise.all([api.get<QueueMetrics[]>('/queues'), api.get<FailedJob[]>('/queues/failed')])
      .then(([queuesData, failedData]) => {
        setQueues(queuesData);
        setFailedJobs(failedData);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  };

  useEffect(fetchAll, []);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(fetchAll, 10_000);
    return () => clearInterval(timer);
  }, [auto]);

  if (error) return <Alert type="error" message={error} />;

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

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={fetchAll}>Refresh</Button>
        <span>Auto-refresh (10s):</span>
        <Switch checked={auto} onChange={setAuto} />
      </Space>
      <Spin spinning={loading}>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          {queues.map((q) => (
            <Col xs={24} sm={12} xl={6} key={q.platform}>
              <Card
                size="small"
                title={(
                  <Space>
                    <Tag>{q.platform}</Tag>
                    {q.waiting + q.active > 0 && <Tag color="blue">busy</Tag>}
                    {q.failed > 0 && <Tag color="red">{q.failed} failed</Tag>}
                  </Space>
                )}
              >
                <Row gutter={[8, 8]}>
                  <Col span={12}><Statistic title="Waiting" value={q.waiting} /></Col>
                  <Col span={12}><Statistic title="Active" value={q.active} /></Col>
                  <Col span={12}><Statistic title="Completed" value={q.completed} /></Col>
                  <Col span={12}><Statistic title="Delayed" value={q.delayed} /></Col>
                </Row>
              </Card>
            </Col>
          ))}
          {queues.length === 0 && !loading && (
            <Col span={24}><Alert type="info" showIcon message="No queue metrics available" /></Col>
          )}
        </Row>
        <Card size="small" title="Summary" style={{ marginBottom: 16 }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={4}><Statistic title="Total waiting" value={total.waiting} /></Col>
            <Col xs={24} sm={12} lg={4}><Statistic title="Total active" value={total.active} /></Col>
            <Col xs={24} sm={12} lg={4}><Statistic title="Total completed" value={total.completed} /></Col>
            <Col xs={24} sm={12} lg={4}><Statistic title="Total failed" value={total.failed} valueStyle={{ color: total.failed > 0 ? '#cf1322' : undefined }} /></Col>
            <Col xs={24} sm={12} lg={4}><Statistic title="Total delayed" value={total.delayed} /></Col>
          </Row>
        </Card>
        <Card
          size="small"
          title={`Failed Jobs (${failedTotal})`}
          extra={failedTotal > 0 && <Tag color="red">{failedTotal} need attention</Tag>}
        >
          {failedTotal === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No failed jobs — all queues healthy" />
          ) : (
            <Table
              dataSource={failedJobs}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 20 }}
              columns={[
                { title: 'Time', dataIndex: 'timestamp', key: 'time', render: (t: number) => new Date(t).toLocaleString() },
                { title: 'Platform', dataIndex: 'platform', key: 'platform', render: (p: string) => <Tag>{p}</Tag> },
                { title: 'Job', dataIndex: 'name', key: 'name' },
                { title: 'Type', dataIndex: 'type', key: 'type', render: (t: string | null) => t ? <Tag color="blue">{t}</Tag> : '—' },
                { title: 'Bot', dataIndex: 'botId', key: 'bot', render: (id: string | null) => id ? <Tag>{id}</Tag> : '—' },
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
