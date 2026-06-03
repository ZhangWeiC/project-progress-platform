import { AppstoreOutlined, BarChartOutlined, DashboardOutlined, ExceptionOutlined, FileExcelOutlined, FormOutlined, SettingOutlined } from '@ant-design/icons';
import { Layout, Menu, Select, Space, Typography } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getCurrentUserId, setCurrentUserId } from '../../services/api';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '业务工作台' },
  { key: '/cases', icon: <AppstoreOutlined />, label: '进度总表' },
  { key: '/work-logs', icon: <FormOutlined />, label: '日报工时' },
  { key: '/exceptions', icon: <ExceptionOutlined />, label: '异常协同' },
  { key: '/imports', icon: <FileExcelOutlined />, label: 'Excel 导入' },
  { key: '/reports', icon: <BarChartOutlined />, label: '统计月报' },
  { key: '/settings/templates', icon: <SettingOutlined />, label: '后台配置' }
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey = menuItems.find((item) => location.pathname.startsWith(item.key))?.key ?? '/dashboard';

  return (
    <Layout className="app-shell">
      <Sider width={184} theme="light" className="app-sider">
        <div className="brand">CaseTask</div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={(event) => navigate(event.key)}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Typography.Text strong>项目进度与工时协作平台</Typography.Text>
          <Space>
            <Typography.Text type="secondary">当前用户</Typography.Text>
            <Select
              size="small"
              value={getCurrentUserId()}
              style={{ width: 132 }}
              onChange={(value) => {
                setCurrentUserId(value);
                window.location.reload();
              }}
              options={[
                { value: 'user-admin', label: '管理员' },
                { value: 'user-zhang', label: '张剑华' },
                { value: 'user-team2', label: '二组班组长' },
                { value: 'user-rao', label: '饶家忠' },
                { value: 'user-li', label: '李嘉俊' }
              ]}
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
