import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Spin, Button, theme, Avatar, Dropdown, Tag, Tooltip } from 'antd';
import {
  DashboardOutlined, RobotOutlined, SettingOutlined, FileTextOutlined, TeamOutlined,
  ApiOutlined, CodeOutlined, BarChartOutlined, MoonOutlined, SunOutlined, UserOutlined,
  LogoutOutlined, GithubOutlined,
} from '@ant-design/icons';
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

const pageMeta: Record<string, { title: string; sub: string }> = {
  '/': { title: 'Dashboard', sub: 'Overview of your bot fleet' },
  '/bots': { title: 'Bots', sub: 'Manage your fleet across all platforms' },
  '/accounts': { title: 'Accounts', sub: 'Platform credentials and linked bots' },
  '/users': { title: 'Users', sub: 'Access control and roles' },
  '/scripts': { title: 'Scripts', sub: 'Automation behaviors and triggers' },
  '/queues': { title: 'Queues', sub: 'Job queues, throughput and failures' },
  '/webhooks': { title: 'Webhooks', sub: 'Outgoing integrations and delivery' },
  '/logs': { title: 'Logs', sub: 'Stream and inspect bot activity' },
  '/settings': { title: 'Settings', sub: 'Account, backup and system info' },
};

function Logo() {
  return (
    <div className="bh-logo">
      <div className="bh-logo-mark">B</div>
      <div>
        <div className="bh-logo-name">BotHive</div>
        <div className="bh-logo-sub">by ssrjkk</div>
      </div>
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { theme: themeName, toggleTheme } = useTheme();
  const [auth, setAuth] = useState<{ authed: boolean; role: string } | null>(null);
  const [me, setMe] = useState<{ id: string; email: string; name?: string | null; role?: string } | null>(null);

  const refreshAuth = () => {
    api.get<{ id: string; email: string; name?: string | null; role?: string }>('/auth/me')
      .then((data) => {
        setMe(data ?? null);
        setAuth({ authed: true, role: data?.role ?? 'viewer' });
      })
      .catch(() => setAuth({ authed: false, role: 'viewer' }));
  };

  useEffect(refreshAuth, []);

  useEffect(() => {
    const onUnauthorized = () => setAuth({ authed: false, role: 'viewer' });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setAuth({ authed: false, role: 'viewer' });
    setMe(null);
  };

  if (auth === null) return <Spin size="large" style={{ display: 'block', margin: '200px auto' }} />;

  if (!auth.authed) return <Login onLogin={refreshAuth} />;

  const isAdmin = auth.role === 'admin';
  const items = isAdmin ? menuItems : menuItems.filter((m) => !adminKeys.has(m.key));

  const meta = location.pathname.startsWith('/bots/')
    ? { title: 'Bot Editor', sub: 'Inspect and drive a single bot' }
    : (pageMeta[location.pathname] ?? { title: 'BotHive', sub: '' });

  const selectedKey = location.pathname.startsWith('/bots/') ? '/bots' : location.pathname;
  const userLabel = me?.name || me?.email?.split('@')[0] || 'user';
  const initial = userLabel.slice(0, 1).toUpperCase();

  const userMenu = {
    items: [
      { key: 'role', label: <span style={{ color: token.colorTextSecondary }}>Signed in as <Tag color={auth.role === 'admin' ? 'geekblue' : 'default'} style={{ marginLeft: 4 }}>{auth.role}</Tag></span>, disabled: true },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: 'Log out', onClick: handleLogout },
    ],
  };

  return (
    <Layout className="bh-app" style={{ minHeight: '100vh' }}>
      <Sider collapsible width={232} theme="dark" trigger={null} className="bh-sider" breakpoint="lg">
        <Logo />
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          onClick={({ key }) => navigate(key)}
        />
        <div style={{ position: 'absolute', bottom: 16, left: 20, right: 20, color: 'rgba(226,229,248,0.4)', fontSize: 11 }}>
          BotHive v1.0.0 · <GithubOutlined /> ssrjkk
        </div>
      </Sider>
      <Layout>
        <Header className="bh-header" style={{ background: token.colorBgContainer }}>
          <div>
            <div className="bh-page-title">{meta.title}</div>
            <div className="bh-page-sub">{meta.sub}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Tooltip title={themeName === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
              <Button
                type="text"
                shape="circle"
                icon={themeName === 'dark' ? <SunOutlined style={{ fontSize: 17 }} /> : <MoonOutlined style={{ fontSize: 17 }} />}
                onClick={toggleTheme}
                aria-label="Toggle theme"
              />
            </Tooltip>
            <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
              <Button type="text" style={{ height: 40, padding: '0 6px', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Avatar style={{ background: 'linear-gradient(135deg,#6d5dfc,#c46bff)', fontWeight: 700 }} size={32}>{initial}</Avatar>
                <span style={{ lineHeight: 1.15, textAlign: 'left' }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>{userLabel}</span>
                  <span style={{ display: 'block', fontSize: 11, opacity: 0.55 }}>{me?.email}</span>
                </span>
              </Button>
            </Dropdown>
          </div>
        </Header>
        <Content className="bh-content">
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
