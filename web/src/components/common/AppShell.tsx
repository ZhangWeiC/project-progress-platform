import { AppstoreOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Button, Layout, Menu, Space, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { getAuthSession, logoutRequest } from '../../services/auth';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/cases', icon: <AppstoreOutlined />, label: '进度总表' },
  { key: '/settings/templates', icon: <SettingOutlined />, label: '后台配置' }
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const user = getAuthSession()?.user;
  const [collapsed, setCollapsed] = useState(true);
  const canManageSettings = user?.permission_level === 'manager';
  const visibleMenuItems = useMemo(
    () => menuItems.filter((item) => item.key !== '/settings/templates' || canManageSettings),
    [canManageSettings]
  );
  const selectedKey = menuItems.find((item) => location.pathname.startsWith(item.key))?.key ?? '/cases';

  useEffect(() => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      navigate('/m/cases', { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (!canManageSettings && location.pathname.startsWith('/settings')) {
      navigate('/cases', { replace: true });
    }
  }, [canManageSettings, location.pathname, navigate]);

  return (
    <Layout className="app-shell">
      <Sider
        width={184}
        collapsedWidth={64}
        collapsed={collapsed}
        theme="light"
        className="app-sider"
        trigger={null}
        onClick={() => collapsed && setCollapsed(false)}
      >
        <div className={`brand ${collapsed ? 'brand-collapsed' : ''}`}>
          <Typography.Text strong className="brand-title">埃弗尔</Typography.Text>
          <Button
            type="text"
            size="small"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            title={collapsed ? '展开菜单' : '收起菜单'}
            onClick={(event) => {
              event.stopPropagation();
              setCollapsed((value) => !value);
            }}
          />
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={visibleMenuItems}
          onClick={(event) => navigate(event.key)}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Typography.Text strong>项目进度平台</Typography.Text>
          <Space>
            <Avatar size={28} icon={<UserOutlined />} />
            <Typography.Text>{user?.name ?? '-'}</Typography.Text>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              title="退出登录"
              onClick={async () => {
                await logoutRequest();
                queryClient.clear();
                navigate('/login', { replace: true });
              }}
            />
          </Space>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
