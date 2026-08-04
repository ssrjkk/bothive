import React, { useState } from 'react';
import { Card, Form, Input, Button, Typography, message, Tabs } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { api } from '../api';

function Login({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleLogin = async (values: { email: string; password: string }) => {
    setLoading(true);
    try {
      await api.login(values.email, values.password);
      onLogin();
    } catch (err) { message.error(String(err)); }
    finally { setLoading(false); }
  };

  const handleRegister = async (values: { email: string; password: string; name?: string }) => {
    setLoading(true);
    try {
      await api.register(values.email, values.password, values.name);
      onLogin();
    } catch (err) { message.error(String(err)); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f0f2f5' }}>
      <Card style={{ width: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Typography.Title level={3} style={{ margin: 0 }}>BotHive</Typography.Title>
          <Typography.Text type="secondary">by ssrjkk</Typography.Text>
        </div>

        <Tabs
          centered
          items={[
            {
              key: 'login', label: 'Login',
              children: (
                <Form layout="vertical" onFinish={handleLogin} autoComplete="off">
                  <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
                    <Input prefix={<UserOutlined />} placeholder="admin@bothive.io" />
                  </Form.Item>
                  <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={loading}>Sign In</Button>
                </Form>
              ),
            },
            {
              key: 'register', label: 'Register',
              children: (
                <Form layout="vertical" onFinish={handleRegister} autoComplete="off">
                  <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
                    <Input prefix={<UserOutlined />} placeholder="admin@bothive.io" />
                  </Form.Item>
                  <Form.Item name="password" label="Password" rules={[{ required: true, min: 8 }]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="min 8 chars" />
                  </Form.Item>
                  <Form.Item name="name" label="Name">
                    <Input placeholder="optional" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={loading}>Create Account</Button>
                </Form>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

export default Login;