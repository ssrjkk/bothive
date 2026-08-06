import React, { useState } from 'react';
import { Form, Input, Button, Typography, message, Tabs } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, CheckOutlined, RocketOutlined } from '@ant-design/icons';
import { api } from '../api';
import { PLATFORM_COLORS } from '../components/meta';

const FEATURES = [
  'One control plane for Telegram, Twitch, YouTube & Twitter',
  'Sandboxed scripts, webhooks and role-based access control',
  'Live logs, worker health and Prometheus metrics',
];

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
      <div className="bh-blob bh-blob-1" />
      <div className="bh-blob bh-blob-2" />
      <div className="bh-blob bh-blob-3" />
      <div className="bh-login-overlay" />

      <div className="bh-login-grid">
        <div className="bh-login-hero">
          <div className="bh-logo-mark">B</div>
          <h1 className="bh-hero-title">Command every bot from one hive.</h1>
          <p className="bh-hero-sub">
            BotHive is the control plane for your multi-platform bot fleet —
            connect accounts, automate behavior, and watch it all live.
          </p>
          {FEATURES.map((f) => (
            <div className="bh-feature" key={f}>
              <span className="bh-feature-check"><CheckOutlined /></span>
              <span>{f}</span>
            </div>
          ))}
          <div className="bh-hero-chips">
            {Object.entries(PLATFORM_COLORS).map(([name, meta]) => (
              <span className="bh-hero-chip" key={name}>
                <span className="bh-dot" style={{ background: meta.hex }} />
                <span style={{ textTransform: 'capitalize' }}>{name}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="bh-login-card">
          <div style={{ textAlign: 'center', padding: '32px 32px 0' }}>
            <div className="bh-brand-ring">
              <div className="bh-logo-mark">B</div>
            </div>
            <Typography.Title level={3} style={{ margin: 0, fontWeight: 800 }}>
              <span className="bh-gradient-text">Welcome back</span>
            </Typography.Title>
            <Typography.Text type="secondary">Sign in to your hive</Typography.Text>
          </div>

          <div style={{ padding: '20px 32px 28px' }}>
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
                      <Button type="primary" htmlType="submit" block size="large" loading={loading} className="bh-login-submit">Sign In</Button>
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
                      <Button type="primary" htmlType="submit" block size="large" loading={loading} className="bh-login-submit">Get Started</Button>
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
            <div className="bh-login-footer">BotHive v1.0.0 · by ssrjkk</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
