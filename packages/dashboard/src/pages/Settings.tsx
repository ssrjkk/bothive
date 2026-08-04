import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Spin, Alert, Button, Form, Input, message, Upload, Space, Modal } from 'antd';
import { LogoutOutlined, LockOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { api } from '../api';

interface QueueMetrics {
  platform: string; waiting: number; active: number;
  completed: number; failed: number; delayed: number;
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
  const [queues, setQueues] = useState<QueueMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [passwordForm] = Form.useForm<ChangePasswordValues>();

  useEffect(() => {
    api.get<QueueMetrics[]>('/queues').then(setQueues).catch(setError).finally(() => setLoading(false));
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

  if (error) return <Alert type="error" message={error} />;

  return (
    <div>
      <Card title="Queue Metrics" style={{ marginBottom: 16 }}>
        {loading ? <Spin /> : (
          <Table dataSource={queues} columns={[
            { title: 'Platform', dataIndex: 'platform', key: 'platform', render: (p: string) => <Tag color="blue">{p}</Tag> },
            { title: 'Waiting', dataIndex: 'waiting', key: 'waiting' },
            { title: 'Active', dataIndex: 'active', key: 'active' },
            { title: 'Completed', dataIndex: 'completed', key: 'completed' },
            { title: 'Failed', dataIndex: 'failed', key: 'failed', render: (v: number) => v > 0 ? <span style={{ color: '#ff4d4f' }}>{v}</span> : v },
            { title: 'Delayed', dataIndex: 'delayed', key: 'delayed' },
          ]} rowKey="platform" pagination={false} />
        )}
      </Card>
      <Card title="Backup & Restore" style={{ marginBottom: 16 }}>
        <p>
          Export a full snapshot of accounts (including platform credentials), bots and scripts as JSON.
          The file is sensitive — keep it safe and never share it.
        </p>
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>Export Backup</Button>
        </Space>
        <Upload.Dragger accept=".json,application/json" showUploadList={false} beforeUpload={(file) => handleImport(file as File)}>
          <p className="ant-upload-drag-icon"><UploadOutlined /></p>
          <p className="ant-upload-text">Click or drop a backup JSON file to restore</p>
          <p className="ant-upload-hint">Accounts are matched by name + platform and updated in place; bots and scripts are matched by name.</p>
        </Upload.Dragger>
      </Card>
      <Card title="Change Password" style={{ marginBottom: 16 }}>
        <Form form={passwordForm} layout="vertical" onFinish={onPasswordChange} style={{ maxWidth: 360 }}>
          <Form.Item name="currentPassword" label="Current Password" rules={[{ required: true, message: 'Enter your current password' }]}>
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item name="newPassword" label="New Password" rules={[{ required: true, min: 8, message: 'At least 8 characters' }]}>
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
          <Button type="primary" htmlType="submit" loading={saving}>Update Password</Button>
        </Form>
      </Card>
      <Card title="System Info">
        <p><strong>BotHive</strong> — Multi-Bot Orchestrator by <strong>ssrjkk</strong></p>
        <p>Platforms: Telegram, Twitch, YouTube, Twitter</p>
        <p>Stack: TypeScript, Node.js, Fastify, BullMQ, Redis, PostgreSQL, Prisma, React, Docker</p>
        <Button icon={<LogoutOutlined />} danger onClick={async () => { await api.logout(); window.location.href = '/login'; }}>Logout</Button>
      </Card>
    </div>
  );
}

export default Settings;
