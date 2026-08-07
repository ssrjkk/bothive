import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Spin, Button, theme, Avatar, Dropdown, Tag, Tooltip } from 'antd';
import {
  DashboardOutlined, RobotOutlined, SettingOutlined, FileTextOutlined, TeamOutlined,
  ApiOutlined, CodeOutlined, BarChartOutlined, MoonOutlined, SunOutlined, UserOutlined,
  LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
} from '@ant-design/icons';
import Login from './pages/Login';
import { api, UNAUTHORIZED_EVENT } from './api';
import { useTheme } from './theme';
import { PageSkeleton } from './components/PageSkeleton';

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

interface MenuItem {
  key: string;
  icon: React.ReactNode;
  label: string;
}

const menuGroups: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Overview',
    items: [{ key: '/', icon: <DashboardOutlined />, label: 'Dashboard' }],
  },
  {
    title: 'Fleet',
    items: [
      { key: '/bots', icon: <RobotOutlined />, label: 'Bots' },
      { key: '/accounts', icon: <TeamOutlined />, label: 'Accounts' },
      { key: '/logs', icon: <FileTextOutlined />, label: 'Logs' },
      { key: '/queues', icon: <BarChartOutlined />, label: 'Queues' },
    ],
  },
  {
    title: 'Automation',
    items: [
      { key: '/scripts', icon: <CodeOutlined />, label: 'Scripts' },
      { key: '/webhooks', icon: <ApiOutlined />, label: 'Webhooks' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { key: '/users', icon: <UserOutlined />, label: 'Users' },
      { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
    ],
  },
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

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="bh-logo">
      <div className="bh-logo-mark">B</div>
      {!collapsed && (
        <div>
          <div className="bh-logo-name">BotHive</div>
          <div className="bh-logo-sub">by ssrjkk</div>
        </div>
      )}
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { theme: themeName, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [auth, setAuth] = useState<{ authed: boolean; role: string } | null>(null);
  const [me, setMe] = useState<{ id: string; email: string; name?: string | null; role?: string } | null>(null);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

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

  useEffect(() => {
    let mounted = true;
    const check = () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      fetch('/api/health/workers', { signal: ctrl.signal, credentials: 'same-origin' })
        .then((r) => { if (mounted) setApiOnline(r.ok); })
        .catch(() => { if (mounted) setApiOnline(false); })
        .finally(() => clearTimeout(timer));
    };
    check();
    const timer = setInterval(check, 20_000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    const path = location.pathname.startsWith('/bots/') ? '/bots' : location.pathname;
    const title = pageMeta[path]?.title;
    document.title = title && title !== 'BotHive' ? `${title} · BotHive` : 'BotHive Dashboard';
  }, [location.pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setAuth({ authed: false, role: 'viewer' });
    setMe(null);
  };

  if (auth === null) return <Spin size="large" style={{ display: 'block', margin: '200px auto' }} />;

  if (!auth.authed) return <Login onLogin={refreshAuth} />;

  const isAdmin = auth.role === 'admin';
  const menuItems = isAdmin
    ? menuGroups.map((g) => ({ type: 'group' as const, label: g.title, children: g.items.map((i) => ({ key: i.key, icon: i.icon, label: i.label })) }))
    : menuGroups
        .map((g) => ({ ...g, items: g.items.filter((i) => !adminKeys.has(i.key)) }))
        .filter((g) => g.items.length > 0)
        .map((g) => ({ type: 'group' as const, label: g.title, children: g.items.map((i) => ({ key: i.key, icon: i.icon, label: i.label })) }));

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
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={232} collapsedWidth={80} theme="dark" trigger={null} className="bh-sider" breakpoint="lg">
        <Logo collapsed={collapsed} />
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
        <div className="bh-sys">
          <span className={`bh-dot ${apiOnline ? 'bh-dot--pulse' : ''}`} style={{ background: apiOnline === null ? '#94a3b8' : apiOnline ? '#16a34a' : '#ef4444' }} />
          <span>{apiOnline === null ? 'connecting…' : apiOnline ? 'all systems operational' : 'api unreachable'}</span>
        </div>
      </Sider>
      <Layout>
        <Header className={`bh-header${scrolled ? ' bh-header--scrolled' : ''}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Button
              type="text"
              shape="circle"
              icon={collapsed ? <MenuUnfoldOutlined style={{ fontSize: 17 }} /> : <MenuFoldOutlined style={{ fontSize: 17 }} />}
              onClick={() => setCollapsed((c) => !c)}
              aria-label="Toggle sidebar"
            />
            <div>
              <div className="bh-page-title">{meta.title}</div>
              <div className="bh-page-sub">{meta.sub}</div>
            </div>
          </div>
          <div className="bh-header-right">
            <div className="bh-api-dot">
              <span className={`bh-dot ${apiOnline ? 'bh-dot--pulse' : ''}`} style={{ background: apiOnline === null ? '#94a3b8' : apiOnline ? '#16a34a' : '#ef4444' }} />
              <span>API {apiOnline === null ? '…' : apiOnline ? 'online' : 'down'}</span>
            </div>
            <Tooltip title={themeName === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
              <Button
                type="text"
                shape="circle"
                icon={
                  <span key={themeName} className="bh-theme-swap">
                    {themeName === 'dark' ? <SunOutlined style={{ fontSize: 17 }} /> : <MoonOutlined style={{ fontSize: 17 }} />}
                  </span>
                }
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
          <div key={location.pathname} className="bh-page">
            <Suspense fallback={<PageSkeleton />}>
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
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
