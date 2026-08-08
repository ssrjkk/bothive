import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Form,
  Input,
  message,
  Upload,
  Space,
  Modal,
  Divider,
  Typography,
  theme,
} from 'antd';
import {
  LogoutOutlined,
  LockOutlined,
  DownloadOutlined,
  UploadOutlined,
  DatabaseOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ErrorState } from '../components/ErrorState';
import { PlatformTag } from '../components/meta';

interface QueueMetrics {
  platform: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface ImportCounts {
  accounts: { created: number; updated: number };
  bots: { created: number; updated: number };
  scripts: { created: number; updated: number };
}

interface ChangePasswordValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

function Settings() {
  const { token } = theme.useToken();
  const [queues, setQueues] = useState<QueueMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [passwordForm] = Form.useForm<ChangePasswordValues>();

  useEffect(() => {
    api
      .get<QueueMetrics[]>('/queues')
      .then(setQueues)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const onPasswordChange = async (values: ChangePasswordValues) => {
    setSaving(true);
    try {
      await api.changePassword(values.currentPassword, values.newPassword);
      message.success('Password updated');
      passwordForm.resetFields();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      const data = await api.get('/backup/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bothive-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('Backup exported');
    } catch (err) {
      message.error(String(err));
    }
  };

  const handleImport = async (file: File) => {
    try {
      const payload = JSON.parse(await file.text());
      const counts = payload?.accounts?.length ?? 0;
      Modal.confirm({
        title: 'Restore backup?',
        content: `This will create/update ${counts} account(s), plus matching bots and scripts. Accounts are updated in place by name + platform.`,
        okText: 'Restore',
        okButtonProps: { danger: true },
        onOk: async () => {
          const result = await api.post<ImportCounts>('/backup/import', payload);
          message.success(
            `Import done: accounts +${result.accounts.created}/updated ${result.accounts.updated}, ` +
              `bots +${result.bots.created}/updated ${result.bots.updated}, scripts +${result.scripts.created}/updated ${result.scripts.updated}`,
          );
        },
      });
    } catch (err) {
      message.error(`Import failed: ${(err as Error).message}`);
    }
    return false;
  };

  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => api.get<QueueMetrics[]>('/queues').then(setQueues).catch(setError)}
      />
    );

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Queue metrics, backup & restore, and account security"
      />

      <Card
        className="bh-card"
        title={
          <span style={{ fontWeight: 700 }}>
            <DatabaseOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />
            Queue Metrics
          </span>
        }
        style={{ marginBottom: 20 }}
      >
        <Table
          dataSource={queues}
          loading={loading}
          columns={[
            {
              title: 'Platform',
              dataIndex: 'platform',
              key: 'platform',
              render: (p: string) => <PlatformTag platform={p} />,
            },
            { title: 'Waiting', dataIndex: 'waiting', key: 'waiting' },
            { title: 'Active', dataIndex: 'active', key: 'active' },
            { title: 'Completed', dataIndex: 'completed', key: 'completed' },
            {
              title: 'Failed',
              dataIndex: 'failed',
              key: 'failed',
              render: (v: number) =>
                v > 0 ? <span style={{ color: '#ef4444', fontWeight: 600 }}>{v}</span> : v,
            },
            { title: 'Delayed', dataIndex: 'delayed', key: 'delayed' },
          ]}
          rowKey="platform"
          pagination={false}
        />
      </Card>

      <Card
        className="bh-card"
        title={
          <span style={{ fontWeight: 700 }}>
            <DownloadOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />
            Backup & Restore
          </span>
        }
        style={{ marginBottom: 20 }}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Export a full snapshot of accounts (including platform credentials), bots and scripts as
          JSON. The file is sensitive — keep it safe and never share it.
        </Typography.Paragraph>
        <Space style={{ marginBottom: 20 }}>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>
            Export Backup
          </Button>
        </Space>
        <Upload.Dragger
          accept=".json,application/json"
          showUploadList={false}
          beforeUpload={(file) => handleImport(file as File)}
        >
          <p className="ant-upload-drag-icon">
            <UploadOutlined />
          </p>
          <p className="ant-upload-text">Click or drop a backup JSON file to restore</p>
          <p className="ant-upload-hint">
            Accounts are matched by name + platform and updated in place; bots and scripts are
            matched by name.
          </p>
        </Upload.Dragger>
      </Card>

      <Card
        className="bh-card"
        title={
          <span style={{ fontWeight: 700 }}>
            <LockOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />
            Change Password
          </span>
        }
        style={{ marginBottom: 20 }}
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={onPasswordChange}
          style={{ maxWidth: 360 }}
        >
          <Form.Item
            name="currentPassword"
            label="Current Password"
            rules={[{ required: true, message: 'Enter your current password' }]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="New Password"
            rules={[{ required: true, min: 8, message: 'At least 8 characters' }]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="Confirm New Password"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Confirm your new password' },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  !value || getFieldValue('newPassword') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('Passwords do not match')),
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            Update Password
          </Button>
        </Form>
      </Card>

      <Card className="bh-card" variant="borderless">
        <Typography.Text strong style={{ fontSize: 15 }}>
          <InfoCircleOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />
          System Info
        </Typography.Text>
        <Divider style={{ margin: '12px 0' }} />
        <Typography.Paragraph style={{ marginBottom: 6 }}>
          <strong>BotHive</strong> — Multi-Bot Orchestrator by <strong>ssrjkk</strong>
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 6 }}>
          Platforms: Telegram, Twitch, YouTube, Twitter
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 20 }}>
          Stack: TypeScript, Node.js, Fastify, BullMQ, Redis, PostgreSQL, Prisma, React, Docker
        </Typography.Paragraph>
        <Button
          icon={<LogoutOutlined />}
          danger
          onClick={async () => {
            await api.logout();
            window.location.href = '/login';
          }}
        >
          Logout
        </Button>
      </Card>
    </div>
  );
}

export default Settings;
