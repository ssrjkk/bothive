import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Spin, Alert, Button, Form, Input, Select, Modal, Popconfirm, message, Typography } from 'antd';
import { UserAddOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from '../api';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'viewer';
  createdAt: string;
}

interface CreateUserValues {
  email: string;
  password: string;
  name?: string;
  role: 'admin' | 'viewer';
}

const ROLE_COLOR: Record<string, string> = { admin: 'geekblue', viewer: 'default' };

function Users() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [createForm] = Form.useForm<CreateUserValues>();

  const load = () => {
    api.get<UserRow[]>('/auth/users').then(setUsers).catch(setError).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get<{ id: string }>('/auth/me').then((me) => setMeId(me?.id ?? null)).catch(() => setMeId(null));
  }, []);

  const onCreate = async (values: CreateUserValues) => {
    setCreating(true);
    try {
      await api.post('/auth/users', { ...values, role: values.role ?? 'viewer' });
      message.success('User created');
      setModalOpen(false);
      createForm.resetFields();
      load();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const onRoleChange = async (userId: string, role: 'admin' | 'viewer') => {
    try {
      await api.patch(`/auth/users/${userId}/role`, { role });
      message.success('Role updated');
      load();
    } catch (err) {
      message.error((err as Error).message);
      load();
    }
  };

  const onDelete = async (userId: string) => {
    try {
      await api.delete(`/auth/users/${userId}`);
      message.success('User deleted');
      load();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  if (error) return <Alert type="error" message={error} />;

  const columns = [
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v: string | null) => v ?? '—' },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role: 'admin' | 'viewer', record: UserRow) => (
        <Select
          value={role}
          size="small"
          style={{ width: 110 }}
          disabled={record.id === meId}
          onChange={(next) => onRoleChange(record.id, next)}
          options={[
            { value: 'admin', label: <Tag color={ROLE_COLOR.admin}>admin</Tag> },
            { value: 'viewer', label: <Tag color={ROLE_COLOR.viewer}>viewer</Tag> },
          ]}
        />
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => (v ? new Date(v).toLocaleString() : '—'),
    },
    {
      title: '',
      key: 'actions',
      render: (_: unknown, record: UserRow) => (
        <Popconfirm
          title="Delete this user?"
          description={`${record.email} will immediately lose access.`}
          okText="Delete"
          okButtonProps={{ danger: true }}
          disabled={record.id === meId}
          onConfirm={() => onDelete(record.id)}
        >
          <Button size="small" danger icon={<DeleteOutlined />} disabled={record.id === meId} aria-label="Delete user" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="Users"
        style={{ marginBottom: 16 }}
        extra={
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setModalOpen(true)}>
            Create User
          </Button>
        }
      >
        {loading ? <Spin /> : <Table dataSource={users} columns={columns} rowKey="id" pagination={false} />}
        <Typography.Text type="secondary">
          You cannot demote or delete yourself, and BotHive always keeps at least one admin.
        </Typography.Text>
      </Card>

      <Modal
        title="Create User"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={creating}
      >
        <Form form={createForm} layout="vertical" onFinish={onCreate}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 8, message: 'At least 8 characters' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="name" label="Name">
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="role" label="Role" initialValue="viewer" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'admin', label: 'admin' },
                { value: 'viewer', label: 'viewer' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default Users;
