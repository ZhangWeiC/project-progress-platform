import { AppstoreOutlined, ExceptionOutlined, FormOutlined, LogoutOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { Button, Layout, Menu, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getAuthSession, logoutRequest } from '../../services/auth';

export function MobileShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const user = getAuthSession()?.user;
  const selected = location.pathname.includes('/m/tasks')
    ? '/m/tasks'
    : location.pathname.includes('/m/work-logs')
      ? '/m/work-logs/new'
      : location.pathname.includes('/m/exceptions')
        ? '/m/exceptions'
        : '/m';

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
        selectedKeys={[selected]}
        onClick={(event) => navigate(event.key)}
        items={[
          { key: '/m', icon: <AppstoreOutlined />, label: '工作台' },
          { key: '/m/tasks', icon: <UnorderedListOutlined />, label: '任务' },
          { key: '/m/work-logs/new', icon: <FormOutlined />, label: '日报' },
          { key: '/m/exceptions', icon: <ExceptionOutlined />, label: '异常' }
        ]}
      />
    </Layout>
  );
}
