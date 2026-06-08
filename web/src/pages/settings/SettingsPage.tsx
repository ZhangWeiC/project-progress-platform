import { Alert, Button, Card, Descriptions, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchWorkflowTemplate } from '../../services/cases';
import { apiGet, apiPost } from '../../services/api';
import type { WorkflowStage } from '../../types';

export function SettingsPage() {
  const { section = 'templates' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workflowQuery = useQuery({
    queryKey: ['workflow-template'],
    queryFn: fetchWorkflowTemplate
  });
  const feishuStatusQuery = useQuery({
    queryKey: ['feishu-status'],
    queryFn: () => apiGet<FeishuStatus>('/api/admin/feishu/status')
  });
  const feishuContactsQuery = useQuery({
    queryKey: ['feishu-contacts'],
    queryFn: () => apiGet<FeishuContactsResponse>('/api/admin/feishu/contacts')
  });
  const feishuSyncMutation = useMutation({
    mutationFn: () => apiPost<FeishuSyncStats>('/api/admin/feishu/sync-contacts', {}),
    onSuccess: (stats) => {
      message.success(`飞书同步完成：新增 ${stats.employees_created} 人，更新 ${stats.employees_updated} 人`);
      queryClient.invalidateQueries({ queryKey: ['feishu-status'] });
      queryClient.invalidateQueries({ queryKey: ['feishu-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['lookups'] });
    },
    onError: (error) => message.error(error.message)
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
          {
            key: 'feishu',
            label: '飞书通讯录',
            children: (
              <FeishuSyncPanel
                status={feishuStatusQuery.data}
                loading={feishuStatusQuery.isLoading}
                error={feishuStatusQuery.error}
                syncing={feishuSyncMutation.isPending}
                contacts={feishuContactsQuery.data}
                contactsLoading={feishuContactsQuery.isLoading}
                contactsError={feishuContactsQuery.error}
                onSync={() => feishuSyncMutation.mutate()}
              />
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


type FeishuStatus = {
  configured: boolean;
  redirect_uri: string;
  root_department_id: string;
  linked_employees: number;
  linked_departments: number;
  last_synced_at?: string | null;
};

type FeishuSyncStats = {
  departments_created: number;
  departments_updated: number;
  employees_created: number;
  employees_updated: number;
  employees_deactivated: number;
  started_at: string;
  finished_at: string;
};

type FeishuContactEmployee = {
  id: string;
  name: string;
  role: string;
  feishu_open_id?: string | null;
  group_department_id?: string | null;
  is_primary?: number | null;
};

type FeishuContactDepartment = {
  id: string;
  name: string;
  parent_department_id?: string | null;
  feishu_open_department_id?: string | null;
  employee_count: number;
  employees: FeishuContactEmployee[];
  children?: FeishuContactDepartment[];
};

type FeishuContactsResponse = {
  departments: FeishuContactDepartment[];
  flat_departments?: FeishuContactDepartment[];
  unassigned: FeishuContactEmployee[];
};

function FeishuSyncPanel({
  status,
  loading,
  error,
  syncing,
  contacts,
  contactsLoading,
  contactsError,
  onSync
}: {
  status?: FeishuStatus;
  loading: boolean;
  error: Error | null;
  syncing: boolean;
  contacts?: FeishuContactsResponse;
  contactsLoading: boolean;
  contactsError: Error | null;
  onSync: () => void;
}) {
  if (error) return <Alert type="error" message={error.message} />;
  if (loading) return <Typography.Text type="secondary">正在读取飞书配置...</Typography.Text>;
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {status && !status.configured ? (
        <Alert
          type="warning"
          showIcon
          message="飞书应用尚未配置完整"
          description="请在后端环境变量中配置 FEISHU_APP_ID、FEISHU_APP_SECRET 和 FEISHU_REDIRECT_URI。"
        />
      ) : null}
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="配置状态">
          <Tag color={status?.configured ? 'green' : 'orange'}>{status?.configured ? '已配置' : '待配置'}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="根部门 ID">{status?.root_department_id ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="已绑定部门">{status?.linked_departments ?? 0}</Descriptions.Item>
        <Descriptions.Item label="已绑定人员">{status?.linked_employees ?? 0}</Descriptions.Item>
        <Descriptions.Item label="最后同步">{status?.last_synced_at ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="回调地址">{status?.redirect_uri || '-'}</Descriptions.Item>
      </Descriptions>
      <Button type="primary" loading={syncing} disabled={!status?.configured} onClick={onSync}>
        同步飞书通讯录
      </Button>
      <FeishuDepartmentTable contacts={contacts} loading={contactsLoading} error={contactsError} />
    </Space>
  );
}

function FeishuDepartmentTable({ contacts, loading, error }: { contacts?: FeishuContactsResponse; loading: boolean; error: Error | null }) {
  if (error) return <Alert type="error" message={error.message} />;
  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Typography.Title level={5}>按部门展示</Typography.Title>
      <Table<FeishuContactDepartment>
        rowKey="id"
        size="small"
        loading={loading}
        pagination={false}
        dataSource={contacts?.departments ?? []}
        expandable={{
          expandedRowRender: (department) => (
            <EmployeeTable rows={department.employees} emptyText="该部门暂无人员" />
          ),
          rowExpandable: (department) => department.employees.length > 0 || Boolean(department.children?.length)
        }}
        columns={[
          { title: '部门', dataIndex: 'name', render: (value) => value || '未命名部门' },
          { title: '人员数', dataIndex: 'employees', width: 100, render: (employees: FeishuContactEmployee[]) => employees.length },
          { title: '飞书部门 ID', dataIndex: 'feishu_open_department_id', width: 280, render: (value) => value || '-' }
        ]}
      />
      {contacts?.unassigned?.length ? (
        <Card size="small" title="未分配部门">
          <EmployeeTable rows={contacts.unassigned} emptyText="暂无未分配人员" />
        </Card>
      ) : null}
    </Space>
  );
}

function EmployeeTable({ rows, emptyText }: { rows: FeishuContactEmployee[]; emptyText: string }) {
  return (
    <Table<FeishuContactEmployee>
      rowKey="id"
      size="small"
      pagination={false}
      locale={{ emptyText }}
      dataSource={rows}
      columns={[
        { title: '姓名', dataIndex: 'name' },
        { title: '角色', dataIndex: 'role', width: 140 },
        { title: '主部门', dataIndex: 'is_primary', width: 90, render: (value) => value ? <Tag color="blue">是</Tag> : '-' },
        { title: '飞书 Open ID', dataIndex: 'feishu_open_id', width: 260, render: (value) => value || '-' }
      ]}
    />
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
