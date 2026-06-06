import { Alert, Card, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchWorkflowTemplate } from '../../services/cases';
import type { WorkflowStage } from '../../types';

export function SettingsPage() {
  const { section = 'templates' } = useParams();
  const navigate = useNavigate();
  const workflowQuery = useQuery({
    queryKey: ['workflow-template'],
    queryFn: fetchWorkflowTemplate
  });

  return (
    <Card>
      <Typography.Title level={4}>后台配置</Typography.Title>
      <Tabs
        activeKey={section}
        onChange={(key) => navigate(`/settings/${key}`)}
        items={[
          {
            key: 'templates',
            label: '模板配置',
            children: workflowQuery.error ? (
              <Alert type="error" message={workflowQuery.error.message} />
            ) : (
              <WorkflowTemplateTable rows={workflowQuery.data?.stages ?? []} loading={workflowQuery.isLoading} />
            )
          },
          { key: 'views', label: '视图配置', children: <ConfigTable rows={viewRows} /> },
          { key: 'permissions', label: '权限配置', children: <ConfigTable rows={permissionRows} /> },
          { key: 'dictionaries', label: '字典配置', children: <ConfigTable rows={dictionaryRows} /> }
        ]}
      />
    </Card>
  );
}

function WorkflowTemplateTable({ rows, loading }: { rows: WorkflowStage[]; loading: boolean }) {
  return (
    <Table<WorkflowStage>
      rowKey="id"
      size="small"
      loading={loading}
      pagination={false}
      dataSource={rows}
      columns={[
        { title: '顺序', dataIndex: 'sort_order', width: 72, render: (_value, _row, index) => index + 1 },
        { title: '阶段', dataIndex: 'name', width: 130, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
        {
          title: '层级',
          dataIndex: 'generation_scope',
          width: 110,
          render: (value) => <Tag color={value === 'case' ? 'blue' : 'default'}>{value === 'case' ? '项目级' : '子项目级'}</Tag>
        },
        {
          title: '子流程',
          dataIndex: 'subprocesses',
          render: (subprocesses: WorkflowStage['subprocesses']) => (
            <Space size={[4, 4]} wrap>
              {subprocesses.map((item, index) => (
                <Tag key={item.id}>{index + 1}. {item.name}</Tag>
              ))}
            </Space>
          )
        },
        { title: '责任部门', dataIndex: 'owner_department_name', width: 120, render: (value) => value || '-' },
        { title: '进度汇总', dataIndex: 'progress_rule', width: 110, render: (value) => value === 'average' ? '子流程平均' : '手工维护' }
      ]}
    />
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
