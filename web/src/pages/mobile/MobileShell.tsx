import { LogoutOutlined, ProjectOutlined } from '@ant-design/icons';
import { Button, Layout, Menu, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useNavigate } from 'react-router-dom';
import { getAuthSession, logoutRequest } from '../../services/auth';

export function MobileShell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = getAuthSession()?.user;

  return (
    <Layout className="mobile-shell">
      <header className="mobile-header">
        <Typography.Text strong>{user?.name ?? '项目进度平台'}</Typography.Text>
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
      </header>
      <div className="mobile-content">
        <Outlet />
      </div>
      <Menu
        className="mobile-tabbar"
        mode="horizontal"
        selectedKeys={['/m/cases']}
        onClick={(event) => navigate(event.key)}
        items={[
          { key: '/m/cases', icon: <ProjectOutlined />, label: '项目' }
        ]}
      />
    </Layout>
  );
}
