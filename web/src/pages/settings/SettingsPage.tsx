import { DeleteOutlined, EditOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchWorkflowTemplate, updateWorkflowStageRequirement } from '../../services/cases';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../services/api';
import type { WorkflowStage } from '../../types';

export function SettingsPage() {
  const { section = 'templates' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [employeeForm] = Form.useForm<FeishuEmployeeFormValues>();
  const [editingEmployee, setEditingEmployee] = useState<FeishuContactEmployee | null>(null);
  const workflowQuery = useQuery({
    queryKey: ['workflow-template'],
    queryFn: fetchWorkflowTemplate
  });
  const workflowStageRequirementMutation = useMutation({
    mutationFn: ({ stageId, required }: { stageId: string; required: boolean }) => updateWorkflowStageRequirement(stageId, required),
    onSuccess: (result) => {
      message.success(result.updated_item_count > 0 ? `配置已更新，并补齐 ${result.updated_item_count} 个已发货子项目` : '阶段配置已更新');
      queryClient.invalidateQueries({ queryKey: ['workflow-template'] });
      queryClient.invalidateQueries({ queryKey: ['case-matrix'] });
    },
    onError: (error) => message.error(error.message)
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
  const feishuEmployeeUpdateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: FeishuEmployeeFormValues }) => apiPatch<FeishuContactEmployee>(`/api/admin/feishu/employees/${id}`, values),
    onSuccess: () => {
      message.success('通讯录人员已更新');
      refreshFeishuContacts();
      setEditingEmployee(null);
      employeeForm.resetFields();
    },
    onError: (error) => message.error(error.message)
  });
  const feishuEmployeeDeleteMutation = useMutation({
    mutationFn: (employeeId: string) => apiDelete<{ ok: boolean }>(`/api/admin/feishu/employees/${employeeId}`),
    onSuccess: () => {
      message.success('通讯录人员已删除');
      refreshFeishuContacts();
    },
    onError: (error) => message.error(error.message)
  });
  const feishuEmployeeDepartmentRemoveMutation = useMutation({
    mutationFn: ({ employeeId, departmentId }: { employeeId: string; departmentId: string }) => (
      apiDelete<{ ok: boolean }>(`/api/admin/feishu/departments/${encodeURIComponent(departmentId)}/employees/${encodeURIComponent(employeeId)}`)
    ),
    onSuccess: () => {
      message.success('已从当前部门移除');
      refreshFeishuContacts();
    },
    onError: (error) => message.error(error.message)
  });

  function refreshFeishuContacts() {
    queryClient.invalidateQueries({ queryKey: ['feishu-status'] });
    queryClient.invalidateQueries({ queryKey: ['feishu-contacts'] });
    queryClient.invalidateQueries({ queryKey: ['lookups'] });
  }

  function openEmployeeEditor(employee: FeishuContactEmployee) {
    setEditingEmployee(employee);
    employeeForm.setFieldsValue({
      name: employee.name,
      permission_level: normalizePermissionLevel(employee.permission_level)
    });
  }

  function closeEmployeeEditor() {
    setEditingEmployee(null);
    employeeForm.resetFields();
  }

  function submitEmployeeForm(values: FeishuEmployeeFormValues) {
    if (!editingEmployee) return;
    feishuEmployeeUpdateMutation.mutate({ id: editingEmployee.id, values });
  }

  return (
    <>
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
                <WorkflowTemplateTable
                  rows={workflowQuery.data?.stages ?? []}
                  loading={workflowQuery.isLoading}
                  updatingStageId={workflowStageRequirementMutation.variables?.stageId}
                  onRequirementChange={(stageId, required) => workflowStageRequirementMutation.mutate({ stageId, required })}
                />
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
                  deletingEmployeeId={feishuEmployeeDeleteMutation.variables}
                  removingMembershipKey={feishuEmployeeDepartmentRemoveMutation.variables ? `${feishuEmployeeDepartmentRemoveMutation.variables.departmentId}:${feishuEmployeeDepartmentRemoveMutation.variables.employeeId}` : undefined}
                  onSync={() => feishuSyncMutation.mutate()}
                  onEditEmployee={openEmployeeEditor}
                  onRemoveEmployeeFromDepartment={(employeeId, departmentId) => feishuEmployeeDepartmentRemoveMutation.mutate({ employeeId, departmentId })}
                  onDeleteEmployee={(employeeId) => feishuEmployeeDeleteMutation.mutate(employeeId)}
                />
              )
            },
            { key: 'permissions', label: '权限配置', children: <PermissionTable /> }
          ]}
        />
      </Card>
      <Modal
        title="编辑通讯录人员"
        open={Boolean(editingEmployee)}
        okText="保存"
        cancelText="取消"
        confirmLoading={feishuEmployeeUpdateMutation.isPending}
        onCancel={closeEmployeeEditor}
        onOk={() => employeeForm.submit()}
        destroyOnClose
      >
        <Form<FeishuEmployeeFormValues> form={employeeForm} layout="vertical" onFinish={submitEmployeeForm}>
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item label="权限层级" name="permission_level" rules={[{ required: true, message: '请选择权限层级' }]}>
            <Select options={permissionOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </>
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
  permission_level?: PermissionLevel | null;
  feishu_open_id?: string | null;
  group_department_id?: string | null;
  is_primary?: number | null;
};

type PermissionLevel = 'manager' | 'editor' | 'viewer';

type FeishuEmployeeFormValues = {
  name: string;
  permission_level: PermissionLevel;
};

type FeishuContactDepartment = {
  id: string;
  name: string;
  parent_department_id?: string | null;
  feishu_open_department_id?: string | null;
  leader_user_id?: string | null;
  leader_name?: string | null;
  employee_count: number;
  employees: FeishuContactEmployee[];
  children?: FeishuContactDepartment[];
};

type FeishuContactsResponse = {
  departments: FeishuContactDepartment[];
  flat_departments?: FeishuContactDepartment[];
  unassigned: FeishuContactEmployee[];
};

type FeishuContactTreeRow = {
  id: string;
  name: string;
  row_type: 'department' | 'employee';
  department?: FeishuContactDepartment;
  employee?: FeishuContactEmployee;
  current_department_id?: string;
  current_department_name?: string;
  children?: FeishuContactTreeRow[];
};

const permissionOptions = [
  { value: 'manager', label: '可管理' },
  { value: 'editor', label: '可编辑' },
  { value: 'viewer', label: '可查看' }
];

function FeishuSyncPanel({
  status,
  loading,
  error,
  syncing,
  contacts,
  contactsLoading,
  contactsError,
  deletingEmployeeId,
  removingMembershipKey,
  onSync,
  onEditEmployee,
  onRemoveEmployeeFromDepartment,
  onDeleteEmployee
}: {
  status?: FeishuStatus;
  loading: boolean;
  error: Error | null;
  syncing: boolean;
  contacts?: FeishuContactsResponse;
  contactsLoading: boolean;
  contactsError: Error | null;
  deletingEmployeeId?: string;
  removingMembershipKey?: string;
  onSync: () => void;
  onEditEmployee: (employee: FeishuContactEmployee) => void;
  onRemoveEmployeeFromDepartment: (employeeId: string, departmentId: string) => void;
  onDeleteEmployee: (employeeId: string) => void;
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
      <FeishuDepartmentTable
        contacts={contacts}
        loading={contactsLoading}
        error={contactsError}
        deletingEmployeeId={deletingEmployeeId}
        removingMembershipKey={removingMembershipKey}
        onEditEmployee={onEditEmployee}
        onRemoveEmployeeFromDepartment={onRemoveEmployeeFromDepartment}
        onDeleteEmployee={onDeleteEmployee}
      />
    </Space>
  );
}

function FeishuDepartmentTable({
  contacts,
  loading,
  error,
  deletingEmployeeId,
  removingMembershipKey,
  onEditEmployee,
  onRemoveEmployeeFromDepartment,
  onDeleteEmployee
}: {
  contacts?: FeishuContactsResponse;
  loading: boolean;
  error: Error | null;
  deletingEmployeeId?: string;
  removingMembershipKey?: string;
  onEditEmployee: (employee: FeishuContactEmployee) => void;
  onRemoveEmployeeFromDepartment: (employeeId: string, departmentId: string) => void;
  onDeleteEmployee: (employeeId: string) => void;
}) {
  if (error) return <Alert type="error" message={error.message} />;
  const rows = buildFeishuContactTree(contacts?.departments ?? []);
  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Typography.Title level={5}>按部门展示</Typography.Title>
      <Table<FeishuContactTreeRow>
        rowKey="id"
        size="small"
        loading={loading}
        pagination={false}
        indentSize={24}
        dataSource={rows}
        columns={[
          {
            title: '部门 / 人员',
            dataIndex: 'name',
            render: (_value, row) => {
              if (row.row_type === 'employee') return row.employee?.name ?? '-';
              const department = row.department;
              const childCount = department?.children?.length ?? 0;
              return (
                <Space size={6} wrap>
                  <Typography.Text strong>{department?.name || '未命名部门'}</Typography.Text>
                  {department?.leader_name ? <Tag color="blue">负责人：{department.leader_name}</Tag> : null}
                  {childCount > 0 ? <Tag>{childCount} 子部门</Tag> : null}
                </Space>
              );
            }
          },
          {
            title: '人员数 / 权限',
            width: 140,
            render: (_value, row) => {
              if (row.row_type === 'employee') {
                return <Tag color={permissionLevelColor(row.employee?.permission_level ?? 'viewer')}>{permissionLabel(row.employee?.permission_level ?? 'viewer')}</Tag>;
              }
              return `${row.department?.employees.length ?? 0}`;
            }
          },
          {
            title: '操作',
            key: 'actions',
            width: 128,
            fixed: 'right',
            align: 'right',
            render: (_value, row) => row.employee ? (
              <EmployeeActions
                employee={row.employee}
                departmentId={row.current_department_id}
                departmentName={row.current_department_name}
                deletingEmployeeId={deletingEmployeeId}
                removingMembershipKey={removingMembershipKey}
                onEdit={onEditEmployee}
                onRemoveFromDepartment={onRemoveEmployeeFromDepartment}
                onDelete={onDeleteEmployee}
              />
            ) : null
          }
        ]}
      />
      {contacts?.unassigned?.length ? (
        <Card size="small" title="未分配部门">
          <EmployeeTable
            rows={contacts.unassigned}
            emptyText="暂无未分配人员"
            deletingEmployeeId={deletingEmployeeId}
            onEdit={onEditEmployee}
            onDelete={onDeleteEmployee}
          />
        </Card>
      ) : null}
    </Space>
  );
}

function buildFeishuContactTree(departments: FeishuContactDepartment[]): FeishuContactTreeRow[] {
  return departments.map((department) => buildFeishuDepartmentRow(department));
}

function buildFeishuDepartmentRow(department: FeishuContactDepartment): FeishuContactTreeRow {
  const children = [
    ...(department.children ?? []).map((child) => buildFeishuDepartmentRow(child)),
    ...department.employees.map((employee) => ({
      id: `${department.id}-${employee.id}`,
      name: employee.name,
      row_type: 'employee' as const,
      employee,
      current_department_id: department.id,
      current_department_name: department.name
    }))
  ];

  return {
    id: department.id,
    name: department.name,
    row_type: 'department',
    department,
    children: children.length > 0 ? children : undefined
  };
}

function EmployeeTable({
  rows,
  emptyText,
  deletingEmployeeId,
  onEdit,
  onDelete
}: {
  rows: FeishuContactEmployee[];
  emptyText: string;
  deletingEmployeeId?: string;
  onEdit: (employee: FeishuContactEmployee) => void;
  onDelete: (employeeId: string) => void;
}) {
  return (
    <Table<FeishuContactEmployee>
      rowKey="id"
      size="small"
      pagination={false}
      scroll={{ x: 360 }}
      locale={{ emptyText }}
      dataSource={rows}
      columns={[
        { title: '姓名', dataIndex: 'name' },
        {
          title: '权限',
          dataIndex: 'permission_level',
          width: 100,
          render: (value) => <Tag color={permissionLevelColor(value ?? 'viewer')}>{permissionLabel(value ?? 'viewer')}</Tag>
        },
        {
          title: '操作',
          key: 'actions',
          width: 128,
          fixed: 'right',
          align: 'right',
          render: (_value, row) => <EmployeeActions employee={row} deletingEmployeeId={deletingEmployeeId} onEdit={onEdit} onDelete={onDelete} />
        }
      ]}
    />
  );
}

function EmployeeActions({
  employee,
  departmentId,
  departmentName,
  deletingEmployeeId,
  removingMembershipKey,
  onEdit,
  onRemoveFromDepartment,
  onDelete
}: {
  employee: FeishuContactEmployee;
  departmentId?: string;
  departmentName?: string;
  deletingEmployeeId?: string;
  removingMembershipKey?: string;
  onEdit: (employee: FeishuContactEmployee) => void;
  onRemoveFromDepartment?: (employeeId: string, departmentId: string) => void;
  onDelete: (employeeId: string) => void;
}) {
  const membershipKey = departmentId ? `${departmentId}:${employee.id}` : '';
  return (
    <Space size={2}>
      <Tooltip title="编辑人员">
        <Button type="text" size="small" aria-label="编辑人员" icon={<EditOutlined />} onClick={() => onEdit(employee)} />
      </Tooltip>
      {departmentId && onRemoveFromDepartment ? (
        <Tooltip title="从当前部门移除">
          <Popconfirm
            title="从当前部门移除"
            description={`只从${departmentName ?? '当前部门'}移除，人员仍保留在通讯录。确认移除？`}
            okText="移除"
            cancelText="取消"
            onConfirm={() => onRemoveFromDepartment(employee.id, departmentId)}
          >
            <Button
              type="text"
              size="small"
              aria-label="从当前部门移除"
              icon={<MinusCircleOutlined />}
              loading={removingMembershipKey === membershipKey}
            />
          </Popconfirm>
        </Tooltip>
      ) : null}
      <Tooltip title="删除人员">
        <Popconfirm
          title="删除通讯录人员"
          description="会从平台通讯录和负责人选择中移除，历史记录保留。确认删除？"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => onDelete(employee.id)}
        >
          <Button type="text" danger size="small" aria-label="删除人员" icon={<DeleteOutlined />} loading={deletingEmployeeId === employee.id} />
        </Popconfirm>
      </Tooltip>
    </Space>
  );
}

function permissionLabel(level: string) {
  return permissionOptions.find((option) => option.value === level)?.label ?? level;
}

function normalizePermissionLevel(level?: string | null): PermissionLevel {
  if (level === 'manager' || level === 'editor' || level === 'viewer') return level;
  return 'viewer';
}

function WorkflowTemplateTable({
  rows,
  loading,
  updatingStageId,
  onRequirementChange
}: {
  rows: WorkflowStage[];
  loading: boolean;
  updatingStageId?: string;
  onRequirementChange: (stageId: string, required: boolean) => void;
}) {
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
          title: '必要阶段',
          dataIndex: 'required',
          width: 110,
          render: (value, row) => (
            <Switch
              size="small"
              checked={Boolean(value)}
              loading={updatingStageId === row.id}
              aria-label={`${row.name}是否为必要阶段`}
              onChange={(checked) => onRequirementChange(row.id, checked)}
            />
          )
        },
        {
          title: '子流程',
          dataIndex: 'subprocesses',
          render: (subprocesses: WorkflowStage['subprocesses']) => (
            <Space size={[4, 4]} wrap>
              {subprocesses.map((item, index) => (
                <Tag key={item.id} color={item.allow_project_bulk_update ? 'blue' : undefined}>
                  {index + 1}. {item.name}{item.allow_project_bulk_update ? ' · 项目行批量' : ''}
                </Tag>
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

type PermissionRow = {
  key: string;
  name: string;
  level: string;
  scope: string;
  permissions: string[];
};

function PermissionTable() {
  return (
    <Table<PermissionRow>
      rowKey="key"
      size="small"
      pagination={false}
      dataSource={permissionRows}
      columns={[
        { title: '权限名称', dataIndex: 'name', width: 120, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
        { title: '权限层级', dataIndex: 'level', width: 120, render: (value) => <Tag color={permissionLevelColor(value)}>{value}</Tag> },
        { title: '可见范围', dataIndex: 'scope', width: 220 },
        {
          title: '权限说明',
          dataIndex: 'permissions',
          render: (permissions: string[]) => (
            <Space size={[4, 4]} wrap>
              {permissions.map((item) => <Tag key={item}>{item}</Tag>)}
            </Space>
          )
        }
      ]}
    />
  );
}

const permissionRows: PermissionRow[] = [
  {
    key: 'manager',
    name: '可管理',
    level: 'manager',
    scope: '全部项目与后台数据',
    permissions: ['增删项目', '编辑项目基础信息', '配置负责人', '查看全部进度', '同步飞书通讯录']
  },
  {
    key: 'editor',
    name: '可编辑',
    level: 'editor',
    scope: '自己负责的项目阶段、班组或部门',
    permissions: ['编辑负责阶段进度', '录入日报工时', '处理相关异常', '查看相关项目']
  },
  {
    key: 'viewer',
    name: '可查看',
    level: 'viewer',
    scope: '与自己有关的项目',
    permissions: ['查看项目进度', '查看任务详情', '查看相关异常']
  }
];

function permissionLevelColor(level: string) {
  if (level === 'manager') return 'green';
  if (level === 'editor') return 'blue';
  return 'default';
}
