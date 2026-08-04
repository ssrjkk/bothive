import React, { useEffect, useState } from 'react';
import { Card, Col, Row, Statistic, Tag, Button, Spin, Alert, Space, Switch } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';

interface QueueMetrics {
  platform: string; waiting: number; active: number; completed: number; failed: number; delayed: number;
}

function Queues() {
  const [queues, setQueues] = useState<QueueMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);

  const fetchQueues = () => {
    setLoading(true);
    api.get<QueueMetrics[]>('/queues').then(setQueues).catch(setError).finally(() => setLoading(false));
  };

  useEffect(fetchQueues, []);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(fetchQueues, 10_000);
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

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={fetchQueues}>Refresh</Button>
        <span>Auto-refresh (10s):</span>
        <Switch checked={auto} onChange={setAuto} />
      </Space>
      <Spin spinning={loading}>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          {queues.map((q) => (
            <Col span={6} key={q.platform}>
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
        <Card size="small" title="Summary">
          <Row gutter={16}>
            <Col span={4}><Statistic title="Total waiting" value={total.waiting} /></Col>
            <Col span={4}><Statistic title="Total active" value={total.active} /></Col>
            <Col span={4}><Statistic title="Total completed" value={total.completed} /></Col>
            <Col span={4}><Statistic title="Total failed" value={total.failed} valueStyle={{ color: total.failed > 0 ? '#cf1322' : undefined }} /></Col>
            <Col span={4}><Statistic title="Total delayed" value={total.delayed} /></Col>
          </Row>
        </Card>
      </Spin>
    </div>
  );
}

export default Queues;
