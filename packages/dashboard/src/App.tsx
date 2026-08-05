import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Spin, Button, theme } from 'antd';
import { DashboardOutlined, RobotOutlined, SettingOutlined, FileTextOutlined, TeamOutlined, ApiOutlined, CodeOutlined, BarChartOutlined, MoonOutlined, SunOutlined, UserOutlined } from '@ant-design/icons';
import Login from './pages/Login';
import { api, UNAUTHORIZED_EVENT } from './api';
import { useTheme } from './theme';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Bots = lazy(() => import('./pages/Bots'));
const BotEditor = lazy(() => import('./pages/BotEditor'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Logs = lazy(() => import('./pages/Logs'));
const Settings = lazy(() => import('./pages/Settings'));
const Webhooks = lazy(() => import('./pages/Webhooks'));
const Scripts = lazy(() => import('./pages/Scripts'));
const Queues = lazy(() => import('./pages/Queues'));
const Users = lazy(() => import('./pages/Users'));

const { Header, Sider, Content } = Layout;

const adminKeys = new Set(['/scripts', '/queues', '/webhooks', '/settings', '/users']);

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/bots', icon: <RobotOutlined />, label: 'Bots' },
  { key: '/accounts', icon: <TeamOutlined />, label: 'Accounts' },
  { key: '/users', icon: <UserOutlined />, label: 'Users' },
  { key: '/scripts', icon: <CodeOutlined />, label: 'Scripts' },
  { key: '/queues', icon: <BarChartOutlined />, label: 'Queues' },
  { key: '/webhooks', icon: <ApiOutlined />, label: 'Webhooks' },
  { key: '/logs', icon: <FileTextOutlined />, label: 'Logs' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
];

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { theme: themeName, toggleTheme } = useTheme();
  const [auth, setAuth] = useState<{ authed: boolean; role: string } | null>(null);

  const refreshAuth = () => {
    // Token lives in an httpOnly cookie; the only reliable check is to ask the
    // API. Fail closed: an unknown/missing role claim means read-only viewer.
    api.get<{ role?: string }>('/auth/me')
      .then((me) => setAuth({ authed: true, role: me?.role ?? 'viewer' }))
      .catch(() => setAuth({ authed: false, role: 'viewer' }));
  };

  useEffect(refreshAuth, []);

  useEffect(() => {
    // A 401 anywhere (e.g. the session expired mid-use) drops back to login.
    const onUnauthorized = () => setAuth({ authed: false, role: 'viewer' });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (auth === null) return <Spin size="large" style={{ display: 'block', margin: '200px auto' }} />;

  if (!auth.authed) return <Login onLogin={refreshAuth} />;

  const isAdmin = auth.role === 'admin';
  const items = isAdmin ? menuItems : menuItems.filter((m) => !adminKeys.has(m.key));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible>
        <div style={{ padding: '16px', color: '#fff', textAlign: 'center' }}>
          <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>BotHive</Typography.Title>
          <Typography.Text style={{ color: '#888', fontSize: 10 }}>by ssrjkk</Typography.Text>
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={items} onClick={({ key }) => navigate(key)} />
      </Sider>
      <Layout>
        <Header style={{ background: token.colorBgContainer, padding: '0 24px', borderBottom: `1px solid ${token.colorBorderSecondary}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>BotHive — Multi-Bot Orchestrator by ssrjkk</Typography.Title>
          <Button
            type="text"
            icon={themeName === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
            aria-label="Toggle theme"
          />
        </Header>
        <Content style={{ margin: 16 }}>
          <Suspense fallback={<Spin size="large" style={{ display: 'block', margin: '100px auto' }} />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/bots" element={<Bots />} />
              <Route path="/bots/:id" element={<BotEditor />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/users" element={isAdmin ? <Users /> : <Navigate to="/" replace />} />
              <Route path="/scripts" element={isAdmin ? <Scripts /> : <Navigate to="/" replace />} />
              <Route path="/queues" element={isAdmin ? <Queues /> : <Navigate to="/" replace />} />
              <Route path="/webhooks" element={isAdmin ? <Webhooks /> : <Navigate to="/" replace />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/settings" element={isAdmin ? <Settings /> : <Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;