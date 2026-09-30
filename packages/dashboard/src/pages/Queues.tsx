import React, { useState } from 'react';
import {
  Card,
  Col,
  Row,
  Statistic,
  Button,
  Spin,
  Alert,
  Space,
  Switch,
  Table,
  Empty,
  Typography,
  Tag,
  theme,
} from 'antd';
import { ReloadOutlined, BarChartOutlined, RollbackOutlined } from '@ant-design/icons';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ErrorState } from '../components/ErrorState';
import { CountUp } from '../components/CountUp';
import { PlatformTag } from '../components/meta';
import type { QueueMetrics } from '../types';
import { useApiResource } from '../hooks/useApiResource';

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

interface DeadLetterJob {
  id: string;
  platform: string;
  name: string | null;
  type: string | null;
  botId: string | null;
  failedReason: string | null;
  attemptsMade: number;
  timestamp: number;
}

function Queues() {
  const { token } = theme.useToken();
  const [auto, setAuto] = useState(true);
  const [replaying, setReplaying] = useState<string | null>(null);
  const [replayingAll, setReplayingAll] = useState(false);

  const data = useApiResource(
    async () => {
      const [queuesData, failedData, dlqData] = await Promise.all([
        api.get<QueueMetrics[]>('/queues'),
        api.get<FailedJob[]>('/queues/failed'),
        api.get<DeadLetterJob[]>('/queues/dead-letter'),
      ]);
      return { queues: queuesData, failedJobs: failedData, dlqJobs: dlqData };
    },
    { intervalMs: auto ? 10_000 : undefined, silentRefetch: true },
  );

  const queues = data.data?.queues ?? [];
  const failedJobs = data.data?.failedJobs ?? [];
  const dlqJobs = data.data?.dlqJobs ?? [];

  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;

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
  const dlqTotal = dlqJobs.length;

  const replayDlq = async (job: DeadLetterJob) => {
    setReplaying(job.id);
    try {
      await api.post(`/queues/dead-letter/${job.platform}/${job.id}/replay`);
      data.reload();
    } catch {
      /* surfaced via the table state refresh */
    } finally {
      setReplaying(null);
    }
  };

  const replayAllDlq = async () => {
    setReplayingAll(true);
    try {
      await api.post('/queues/dead-letter/replay-all');
      data.reload();
    } catch {
      /* surfaced via the table state refresh */
    } finally {
      setReplayingAll(false);
    }
  };

  const summaryCards = [
    { title: 'Total waiting', value: total.waiting, color: token.colorText },
    { title: 'Total active', value: total.active, color: token.colorText },
    { title: 'Total completed', value: total.completed, color: token.colorText },
    {
      title: 'Total failed',
      value: total.failed,
      color: total.failed > 0 ? '#ef4444' : token.colorText,
    },
    { title: 'Total delayed', value: total.delayed, color: token.colorText },
    {
      title: 'Dead-letter',
      value: dlqTotal,
      color: dlqTotal > 0 ? '#ef4444' : token.colorText,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Queues"
        description="BullMQ job throughput and failures per platform"
        extra={
          <>
            <Button icon={<ReloadOutlined />} onClick={data.reload}>
              Refresh
            </Button>
            <Space>
              <Typography.Text type="secondary">Auto-refresh (10s)</Typography.Text>
              <Switch checked={auto} onChange={setAuto} />
            </Space>
          </>
        }
      />
      <Spin spinning={data.loading}>
        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          {queues.map((q) => (
            <Col xs={24} sm={12} xl={6} key={q.platform}>
              <Card
                className="bh-card bh-card--lift"
                title={<PlatformTag platform={q.platform} />}
                extra={q.waiting + q.active > 0 ? <Tag color="processing">busy</Tag> : undefined}
              >
                <Row gutter={[8, 8]}>
                  <Col span={12}>
                    <Statistic
                      title="Waiting"
                      value={q.waiting}
                      formatter={(v) => <CountUp value={Number(v)} />}
                      valueStyle={{ fontSize: 20 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="Active"
                      value={q.active}
                      formatter={(v) => <CountUp value={Number(v)} />}
                      valueStyle={{ fontSize: 20 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="Completed"
                      value={q.completed}
                      formatter={(v) => <CountUp value={Number(v)} />}
                      valueStyle={{ fontSize: 20 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="Delayed"
                      value={q.delayed}
                      formatter={(v) => <CountUp value={Number(v)} />}
                      valueStyle={{ fontSize: 20 }}
                    />
                  </Col>
                </Row>
                {q.failed > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Tag color="error" style={{ borderRadius: 999 }}>
                      {q.failed} failed
                    </Tag>
                  </div>
                )}
              </Card>
            </Col>
          ))}
          {queues.length === 0 && !data.loading && (
            <Col span={24}>
              <Alert type="info" showIcon message="No queue metrics available" />
            </Col>
          )}
        </Row>

        <Card
          className="bh-card"
          title={<span style={{ fontWeight: 700 }}>Summary</span>}
          style={{ marginBottom: 20 }}
        >
          <Row gutter={[16, 16]}>
            {summaryCards.map((c) => (
              <Col xs={12} sm={12} lg={4} key={c.title}>
                <Statistic
                  title={c.title}
                  value={c.value}
                  formatter={(v) => <CountUp value={Number(v)} />}
                  valueStyle={{ fontSize: 22, fontWeight: 700, color: c.color }}
                />
              </Col>
            ))}
          </Row>
        </Card>

        <Card
          className="bh-card"
          title={
            <span style={{ fontWeight: 700 }}>
              <BarChartOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
              Failed Jobs ({failedTotal})
            </span>
          }
          extra={
            failedTotal > 0 && (
              <Tag color="error" style={{ borderRadius: 999 }}>
                {failedTotal} need attention
              </Tag>
            )
          }
        >
          {failedTotal === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No failed jobs — all queues healthy"
            />
          ) : (
            <Table
              dataSource={failedJobs}
              rowKey="id"
              size="middle"
              pagination={{
                pageSize: 20,
                showSizeChanger: true,
                showTotal: (t) => `${t} job${t === 1 ? '' : 's'}`,
              }}
              columns={[
                {
                  title: 'Time',
                  dataIndex: 'timestamp',
                  key: 'time',
                  render: (t: number) => (
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
                  title: 'Job',
                  dataIndex: 'name',
                  key: 'name',
                  render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span>,
                },
                {
                  title: 'Type',
                  dataIndex: 'type',
                  key: 'type',
                  render: (t: string | null) =>
                    t ? (
                      <Tag color="processing" style={{ borderRadius: 999 }}>
                        {t}
                      </Tag>
                    ) : (
                      '—'
                    ),
                },
                {
                  title: 'Bot',
                  dataIndex: 'botId',
                  key: 'bot',
                  render: (id: string | null) =>
                    id ? (
                      <Typography.Text code style={{ fontSize: 12.5 }}>
                        {id}
                      </Typography.Text>
                    ) : (
                      '—'
                    ),
                },
                { title: 'Attempts', dataIndex: 'attemptsMade', key: 'attempts', width: 90 },
                { title: 'Reason', dataIndex: 'failedReason', key: 'reason', ellipsis: true },
              ]}
            />
          )}
        </Card>

        <Card
          className="bh-card"
          title={
            <span style={{ fontWeight: 700 }}>
              <RollbackOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
              Dead Letter Queue ({dlqTotal})
            </span>
          }
          extra={
            dlqTotal > 0 && (
              <Button size="small" onClick={replayAllDlq} loading={replayingAll}>
                Replay all
              </Button>
            )
          }
        >
          {dlqTotal === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No dead-lettered jobs — retry budgets are holding"
            />
          ) : (
            <Table
              dataSource={dlqJobs}
              rowKey="id"
              size="middle"
              pagination={{ pageSize: 20, showSizeChanger: true }}
              columns={[
                {
                  title: 'Time',
                  dataIndex: 'timestamp',
                  key: 'time',
                  render: (t: number) => (
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
                  title: 'Job',
                  dataIndex: 'name',
                  key: 'name',
                  render: (v: string | null) => <span style={{ fontWeight: 600 }}>{v ?? '—'}</span>,
                },
                {
                  title: 'Type',
                  dataIndex: 'type',
                  key: 'type',
                  render: (t: string | null) =>
                    t ? (
                      <Tag color="volcano" style={{ borderRadius: 999 }}>
                        {t}
                      </Tag>
                    ) : (
                      '—'
                    ),
                },
                {
                  title: 'Bot',
                  dataIndex: 'botId',
                  key: 'bot',
                  render: (id: string | null) =>
                    id ? (
                      <Typography.Text code style={{ fontSize: 12.5 }}>
                        {id}
                      </Typography.Text>
                    ) : (
                      '—'
                    ),
                },
                {
                  title: 'Attempts',
                  dataIndex: 'attemptsMade',
                  key: 'attempts',
                  width: 90,
                  render: (n: number) => <Tag color={n >= 3 ? 'error' : 'default'}>{n}</Tag>,
                },
                {
                  title: 'Reason',
                  dataIndex: 'failedReason',
                  key: 'reason',
                  ellipsis: true,
                  render: (r: string | null) =>
                    r ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12.5 }} ellipsis>
                        {r}
                      </Typography.Text>
                    ) : (
                      '—'
                    ),
                },
                {
                  title: '',
                  key: 'actions',
                  width: 90,
                  align: 'right',
                  render: (_: unknown, job: DeadLetterJob) => (
                    <Button
                      size="small"
                      type="text"
                      icon={<RollbackOutlined />}
                      loading={replaying === job.id}
                      onClick={() => replayDlq(job)}
                    >
                      Replay
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Card>
      </Spin>
    </div>
  );
}

export default Queues;
