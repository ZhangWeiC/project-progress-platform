import { AppstoreOutlined, ExceptionOutlined, FormOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { Layout, Menu } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

export function MobileShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const selected = location.pathname.includes('/m/tasks')
    ? '/m/tasks'
    : location.pathname.includes('/m/work-logs')
      ? '/m/work-logs/new'
      : location.pathname.includes('/m/exceptions')
        ? '/m/exceptions'
        : '/m';

  return (
    <Layout className="mobile-shell">
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
