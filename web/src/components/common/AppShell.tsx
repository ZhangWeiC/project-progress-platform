import { AppstoreOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Button, Layout, Menu, Space, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
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
  const selectedKey = menuItems.find((item) => location.pathname.startsWith(item.key))?.key ?? '/cases';

  useEffect(() => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      navigate('/m/cases', { replace: true });
    }
  }, [location.pathname, navigate]);

  return (
    <Layout className="app-shell">
      <Sider width={184} theme="light" className="app-sider">
        <div className="brand">项目进度平台</div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
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
