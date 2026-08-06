import React, { useState } from 'react';
import { Form, Input, Button, Typography, message, Tabs, Tag } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, RocketOutlined } from '@ant-design/icons';
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
    <div className="bh-login-bg">
      <div className="bh-login-card">
        <div style={{ textAlign: 'center', padding: '32px 32px 0' }}>
          <div className="bh-logo-mark" style={{ width: 56, height: 56, fontSize: 28, margin: '0 auto 16px', borderRadius: 16 }}>B</div>
          <Typography.Title level={3} style={{ margin: 0, fontWeight: 800 }}>BotHive</Typography.Title>
          <Typography.Text type="secondary">Multi-Bot Orchestrator · by ssrjkk</Typography.Text>
          <div style={{ marginTop: 12 }}>
            <Tag color="cyan" style={{ borderRadius: 999 }}>Telegram</Tag>
            <Tag color="purple" style={{ borderRadius: 999 }}>Twitch</Tag>
            <Tag color="red" style={{ borderRadius: 999 }}>YouTube</Tag>
            <Tag color="blue" style={{ borderRadius: 999 }}>Twitter</Tag>
          </div>
        </div>

        <div style={{ padding: '20px 32px 32px' }}>
          <Tabs
            centered
            items={[
              {
                key: 'login', label: 'Sign In',
                children: (
                  <Form layout="vertical" onFinish={handleLogin} autoComplete="off">
                    <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
                      <Input prefix={<MailOutlined />} placeholder="admin@bothive.io" size="large" />
                    </Form.Item>
                    <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                      <Input.Password prefix={<LockOutlined />} placeholder="password" size="large" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" block size="large" loading={loading}>Sign In</Button>
                  </Form>
                ),
              },
              {
                key: 'register', label: 'Create Account',
                children: (
                  <Form layout="vertical" onFinish={handleRegister} autoComplete="off">
                    <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
                      <Input prefix={<MailOutlined />} placeholder="you@example.com" size="large" />
                    </Form.Item>
                    <Form.Item name="password" label="Password" rules={[{ required: true, min: 8 }]}>
                      <Input.Password prefix={<LockOutlined />} placeholder="min 8 chars" size="large" />
                    </Form.Item>
                    <Form.Item name="name" label="Name">
                      <Input prefix={<UserOutlined />} placeholder="optional" size="large" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" block size="large" loading={loading}>Get Started</Button>
                  </Form>
                ),
              },
            ]}
          />
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <RocketOutlined /> Orchestrate Telegram, Twitch, YouTube &amp; Twitter bots from one place.
            </Typography.Text>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
