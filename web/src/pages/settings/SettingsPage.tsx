import { Card, Table, Tabs, Tag, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';

export function SettingsPage() {
  const { section = 'templates' } = useParams();
  const navigate = useNavigate();
  return (
    <Card>
      <Typography.Title level={4}>后台配置</Typography.Title>
      <Tabs
        activeKey={section}
        onChange={(key) => navigate(`/settings/${key}`)}
        items={[
          { key: 'templates', label: '模板配置', children: <ConfigTable rows={templateRows} /> },
          { key: 'views', label: '视图配置', children: <ConfigTable rows={viewRows} /> },
          { key: 'permissions', label: '权限配置', children: <ConfigTable rows={permissionRows} /> },
          { key: 'dictionaries', label: '字典配置', children: <ConfigTable rows={dictionaryRows} /> }
        ]}
      />
    </Card>
  );
}

type ConfigRow = {
  key: string;
  name: string;
  scope: string;
  status: string;
  updated_at: string;
};

function ConfigTable({ rows }: { rows: ConfigRow[] }) {
  return (
    <Table<ConfigRow>
      rowKey="key"
      size="small"
      pagination={false}
      dataSource={rows}
      columns={[
        { title: '名称', dataIndex: 'name' },
        { title: '范围', dataIndex: 'scope', width: 180 },
        { title: '状态', dataIndex: 'status', width: 100, render: (value) => <Tag color={value === 'active' ? 'green' : 'default'}>{value}</Tag> },
        { title: '更新时间', dataIndex: 'updated_at', width: 160 }
      ]}
    />
  );
}

const templateRows: ConfigRow[] = [
  { key: 'tpl-steel-v1', name: '钢结构项目模板 v1', scope: '通用', status: 'active', updated_at: '2026-04-01' },
  { key: 'tt-material', name: '材料入库任务', scope: '子项目', status: 'active', updated_at: '2026-04-01' },
  { key: 'tt-production', name: '装焊生产任务', scope: '子项目', status: 'active', updated_at: '2026-04-01' }
];

const viewRows: ConfigRow[] = [
  { key: 'default-matrix', name: '项目进度总览', scope: 'Web', status: 'active', updated_at: '2026-04-01' },
  { key: 'mobile-workbench', name: '现场工作台', scope: 'H5', status: 'active', updated_at: '2026-04-01' }
];

const permissionRows: ConfigRow[] = [
  { key: 'case-member-read', name: '项目成员可见', scope: '项目', status: 'active', updated_at: '2026-04-01' },
  { key: 'task-owner-write', name: '当前任务负责人可改', scope: '任务', status: 'active', updated_at: '2026-04-01' }
];

const dictionaryRows: ConfigRow[] = [
  { key: 'exception-type', name: '异常类型', scope: '全局', status: 'active', updated_at: '2026-04-01' },
  { key: 'quantity-unit', name: '数量单位', scope: '全局', status: 'active', updated_at: '2026-04-01' }
];
