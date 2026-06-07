import { CompressOutlined, DeleteOutlined, EditOutlined, ExpandAltOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Card, Divider, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Key } from 'react';
import { TaskDrawer } from '../../components/drawers/TaskDrawer';
import { ProgressCell } from '../../components/matrix/ProgressCell';
import { createProjectCase, deleteProjectCase, fetchAllMatrix, fetchLookups, fetchProjectCaseManageProfile, updateProjectCase } from '../../services/cases';
import type { ProjectCasePayload } from '../../services/cases';
import { getAuthSession } from '../../services/auth';
import type { LookupResponse, MatrixCell, MatrixColumn, MatrixRow, ProjectCase, ProjectStageOwner } from '../../types';

const STAGE_COLORS = ['blue', 'cyan', 'green', 'lime', 'gold', 'orange', 'purple'];

type ProjectCaseFormValues = ProjectCasePayload & {
  stage_owner_values?: Record<string, string | null | undefined>;
};

type StageDefinition = Pick<ProjectStageOwner, 'task_type' | 'task_name' | 'generation_scope' | 'sort_order' | 'owner_department_name' | 'assignee_id' | 'team_id' | 'mixed'>;

export function CaseMatrixPage() {
  const [form] = Form.useForm<ProjectCaseFormValues>();
  const [openedTaskId, setOpenedTaskId] = useState<string>();
  const [expandedRowKeys, setExpandedRowKeys] = useState<Key[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectCase | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const queryClient = useQueryClient();
  const currentUser = getAuthSession()?.user;
  const canManageProjects = Boolean(
    currentUser?.role === 'admin' ||
    currentUser?.role === 'business_owner' ||
    currentUser?.permission_level === 'manager'
  );

  const matrixQuery = useQuery({
    queryKey: ['matrix', 'all'],
    queryFn: fetchAllMatrix
  });
  const lookupsQuery = useQuery({ queryKey: ['lookups'], queryFn: fetchLookups, enabled: canManageProjects });

  const rows = matrixQuery.data?.rows ?? [];
  const projectRowKeys = useMemo(() => rows.map((row) => row.row_id ?? row.case_item_id), [rows]);
  const stageDefinitions = useMemo(() => stageDefinitionsFromColumns(matrixQuery.data?.columns ?? []), [matrixQuery.data?.columns]);

  const filteredRows = useMemo(() => filterRows(rows, searchKeyword), [rows, searchKeyword]);
  const activeExpandedRowKeys = searchKeyword.trim()
    ? filteredRows.map((row) => row.row_id ?? row.case_item_id)
    : expandedRowKeys;

  const refreshProjectQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['matrix', 'all'] }),
      queryClient.invalidateQueries({ queryKey: ['cases'] }),
      queryClient.invalidateQueries({ queryKey: ['workbench'] })
    ]);
  };

  const createMutation = useMutation({
    mutationFn: createProjectCase,
    onSuccess: async () => {
      message.success('项目已新增');
      setProjectModalOpen(false);
      form.resetFields();
      await refreshProjectQueries();
    }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ProjectCasePayload }) => updateProjectCase(id, payload),
    onSuccess: async () => {
      message.success('项目已更新');
      setProjectModalOpen(false);
      setEditingProject(null);
      form.resetFields();
      await refreshProjectQueries();
    }
  });
  const deleteMutation = useMutation({
    mutationFn: deleteProjectCase,
    onSuccess: async () => {
      message.success('项目已删除');
      await refreshProjectQueries();
    }
  });

  const openCreateProject = () => {
    setEditingProject(null);
    form.resetFields();
    form.setFieldsValue({ items: [{ name: '' }] });
    setProjectModalOpen(true);
  };
  const openEditProject = async (row: MatrixRow) => {
    setProfileLoading(true);
    try {
      const project = await fetchProjectCaseManageProfile(row.project_case_id);
      setEditingProject(project);
      form.setFieldsValue(projectToForm(project));
      setProjectModalOpen(true);
    } catch {
      message.error('项目详情加载失败');
    } finally {
      setProfileLoading(false);
    }
  };
  const submitProjectForm = (values: ProjectCaseFormValues) => {
    const stages = editingProject?.stage_owners?.length ? editingProject.stage_owners : stageDefinitions;
    const payload = normalizeProjectPayload(values, stages);
    if (editingProject) {
      updateMutation.mutate({ id: editingProject.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const tableColumns = useMemo(
    () => buildColumns(matrixQuery.data?.columns ?? [], setOpenedTaskId, {
      canManage: canManageProjects,
      onEditProject: openEditProject,
      onDeleteProject: (row) => deleteMutation.mutate(row.project_case_id),
      deleteLoading: deleteMutation.isPending
    }),
    [matrixQuery.data?.columns, canManageProjects, deleteMutation.isPending]
  );

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="page-toolbar">
        <div className="page-title-row">
          <Space wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>
              项目进度总表
            </Typography.Title>
            <Tag color="blue">{matrixQuery.data?.summary?.project_count ?? 0} 项目</Tag>
            <Tag color="geekblue">{matrixQuery.data?.summary?.item_count ?? 0} 子项目</Tag>
            <Tag color={matrixQuery.data?.summary?.open_exception_count ? 'red' : 'default'}>
              {matrixQuery.data?.summary?.open_exception_count ?? 0} 异常
            </Tag>
          </Space>
          <Space wrap>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索项目 / 子项目 / 负责人"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              style={{ width: 280 }}
            />
            <Button icon={<ExpandAltOutlined />} onClick={() => setExpandedRowKeys(projectRowKeys)}>
              展开
            </Button>
            <Button icon={<CompressOutlined />} onClick={() => setExpandedRowKeys([])}>
              折叠
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => matrixQuery.refetch()}>
              刷新
            </Button>
            {canManageProjects && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateProject}>
                新增项目
              </Button>
            )}
          </Space>
        </div>
      </Card>

      <Card className="matrix-card">
        <Table<MatrixRow>
          rowKey={(row) => row.row_id ?? row.case_item_id}
          loading={matrixQuery.isLoading}
          columns={tableColumns}
          dataSource={filteredRows}
          pagination={false}
          size="small"
          bordered
          sticky
          tableLayout="fixed"
          scroll={{ x: 2440, y: 'calc(100vh - 178px)' }}
          expandable={{
            expandedRowKeys: activeExpandedRowKeys,
            onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys]),
            indentSize: 14
          }}
          rowClassName={(row) => {
            const classes = [row.row_type === 'project' ? 'matrix-project-row' : 'matrix-item-row'];
            if (row.open_exception_count > 0) classes.push('row-has-exception');
            return classes.join(' ');
          }}
        />
      </Card>

      <TaskDrawer
        taskId={openedTaskId}
        open={Boolean(openedTaskId)}
        onClose={() => setOpenedTaskId(undefined)}
      />
      <ProjectCaseModal
        open={projectModalOpen}
        editingProject={editingProject}
        form={form}
        lookups={lookupsQuery.data}
        stageDefinitions={editingProject?.stage_owners?.length ? editingProject.stage_owners : stageDefinitions}
        loading={createMutation.isPending || updateMutation.isPending || profileLoading}
        onCancel={() => {
          setProjectModalOpen(false);
          setEditingProject(null);
          form.resetFields();
        }}
        onFinish={submitProjectForm}
      />
    </Space>
  );
}

type MatrixManagementActions = {
  canManage: boolean;
  deleteLoading: boolean;
  onEditProject: (row: MatrixRow) => void;
  onDeleteProject: (row: MatrixRow) => void;
};

function buildColumns(columns: MatrixColumn[], openTask: (taskId: string) => void, management: MatrixManagementActions): ColumnsType<MatrixRow> {
  const leftColumns = columns
    .filter((column) => column.frozen === 'left')
    .map((column) => ({
      title: column.title,
      dataIndex: column.key,
      key: column.key,
      fixed: 'left' as const,
      width: column.key === 'case_name' ? 220 : 190,
      className: `matrix-fixed-left matrix-column-${column.key}`,
      render: (_value: unknown, row: MatrixRow) => renderPinnedCell(column.key, row, management)
    }));

  const rightColumns = columns
    .filter((column) => column.frozen === 'right')
    .map((column) => ({
      title: column.title,
      dataIndex: column.key,
      key: column.key,
      fixed: 'right' as const,
      width: column.key === 'delivery_status' ? 126 : 70,
      className: 'matrix-fixed-right',
      render: (_value: unknown, row: MatrixRow) => renderPinnedCell(column.key, row, management)
    }));

  const groups = new Map<string, MatrixColumn[]>();
  for (const column of columns.filter((item) => !item.frozen)) {
    const group = column.group ?? '其他';
    groups.set(group, [...(groups.get(group) ?? []), column]);
  }

  const groupedColumns: ColumnsType<MatrixRow> = Array.from(groups.entries()).map(([group, children], groupIndex) => {
    const stageColor = STAGE_COLORS[groupIndex % STAGE_COLORS.length];
    return {
      title: <span className="stage-title">{group}</span>,
      key: group,
      className: `matrix-stage-group stage-${stageColor}`,
      onHeaderCell: () => ({ className: `matrix-stage-header stage-${stageColor}` }),
      children: children.map((child) => ({
        title: child.title,
        key: child.key,
        width: 82,
        align: 'center' as const,
        className: `matrix-stage-cell stage-${stageColor}`,
        onHeaderCell: () => ({ className: `matrix-substage-header stage-${stageColor}` }),
        onCell: () => ({ className: `matrix-stage-cell stage-${stageColor}` }),
        render: (_value: unknown, row: MatrixRow) => (
          <ProgressCell cell={row.cells[child.key]} onOpenTask={openTask} />
        )
      }))
    };
  });

  return [...leftColumns, ...groupedColumns, ...rightColumns];
}

function renderPinnedCell(key: string, row: MatrixRow, management: MatrixManagementActions) {
  const cell = row.cells[key];
  const value = cell?.value;
  if (key === 'open_exception_count') {
    const count = Number(value ?? 0);
    return count > 0 ? <Tag color="red">{count}</Tag> : <span className="empty-cell">0</span>;
  }
  if (key === 'case_name') {
    const text = value ? String(value) : row.row_type === 'item' ? '' : '-';
    return (
      <Space direction="vertical" size={0} className="matrix-row-title">
        <div className="matrix-project-title-line">
          <EllipsisText text={text} strong={row.row_type === 'project'} />
          {row.row_type === 'project' && management.canManage && (
            <Space size={2} className="matrix-row-actions">
              <Tooltip title="编辑项目">
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  aria-label="编辑项目"
                  title="编辑项目"
                  onClick={() => management.onEditProject(row)}
                />
              </Tooltip>
              <Popconfirm
                title="删除项目"
                description="会同时删除项目下的子项目、任务、日报和异常，确认删除？"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true, loading: management.deleteLoading }}
                onConfirm={() => management.onDeleteProject(row)}
              >
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label="删除项目"
                  title="删除项目"
                />
              </Popconfirm>
            </Space>
          )}
        </div>
        {row.row_type === 'project' && cell?.ownerName && (
          <EllipsisText text={cell.ownerName} type="secondary" />
        )}
      </Space>
    );
  }
  if (key === 'case_item_name') {
    const text = value ? String(value) : '-';
    return (
      <Space direction="vertical" size={0} className="matrix-row-title">
        <EllipsisText text={text} strong={row.row_type === 'project'} className={!value ? 'empty-cell' : undefined} />
        {row.row_type === 'item' && typeof cell?.aggregateCount === 'number' && (
          <EllipsisText text={`${cell.aggregateCount}%`} type="secondary" />
        )}
      </Space>
    );
  }
  return value ? <EllipsisText text={String(value)} /> : <span className="empty-cell">-</span>;
}

type EllipsisTextProps = {
  text: string;
  strong?: boolean;
  type?: 'secondary';
  className?: string;
};

function EllipsisText({ text, strong, type, className }: EllipsisTextProps) {
  const content = (
    <Typography.Text
      strong={strong}
      type={type}
      className={['matrix-ellipsis-text', className].filter(Boolean).join(' ')}
    >
      {text}
    </Typography.Text>
  );
  if (!text || text === '-') return content;
  return <Tooltip title={text}>{content}</Tooltip>;
}

function filterRows(rows: MatrixRow[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return rows;
  const matchedRows: MatrixRow[] = [];
  for (const row of rows) {
    const children = row.children?.filter((child) => rowMatches(child, normalizedKeyword)) ?? [];
    if (rowMatches(row, normalizedKeyword) || children.length > 0) {
      matchedRows.push({ ...row, children: children.length > 0 ? children : row.children });
    }
  }
  return matchedRows;
}

function rowMatches(row: MatrixRow, keyword: string) {
  return Object.values(row.cells).some((cell: MatrixCell) => {
    const values = [cell.value, cell.ownerName, cell.departmentName];
    return values.some((value) => String(value ?? '').toLowerCase().includes(keyword));
  });
}

type ProjectCaseModalProps = {
  open: boolean;
  editingProject: ProjectCase | null;
  form: ReturnType<typeof Form.useForm<ProjectCaseFormValues>>[0];
  lookups?: LookupResponse;
  stageDefinitions: StageDefinition[];
  loading: boolean;
  onCancel: () => void;
  onFinish: (values: ProjectCaseFormValues) => void;
};

function ProjectCaseModal({ open, editingProject, form, lookups, stageDefinitions, loading, onCancel, onFinish }: ProjectCaseModalProps) {
  const employeeOptions = (lookups?.employees ?? []).map((employee) => ({
    label: employee.name,
    value: employee.id
  }));
  const ownerOptions = [
    {
      label: '人员',
      options: (lookups?.employees ?? []).map((employee) => ({
        label: employee.name,
        value: `employee:${employee.id}`
      }))
    },
    {
      label: '班组',
      options: (lookups?.teams ?? []).map((team) => ({
        label: team.name,
        value: `team:${team.id}`
      }))
    }
  ];
  return (
    <Modal
      title={editingProject ? '编辑项目' : '新增项目'}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText={editingProject ? '保存' : '新增'}
      confirmLoading={loading}
      width={920}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <div className="project-form-grid">
          <Form.Item label="项目名称" name="name" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="请输入项目名称" />
          </Form.Item>
          <Form.Item label="项目编号" name="code">
            <Input placeholder="例如 P-001" />
          </Form.Item>
          <Form.Item label="项目类型" name="category">
            <Input placeholder="例如 护栏模板" />
          </Form.Item>
          <Form.Item label="客户名称" name="customer_name">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item label="预估重量(T)" name="estimated_weight">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="可选" />
          </Form.Item>
          <Form.Item label="业务部负责人" name="business_owner_id">
            <Select allowClear showSearch placeholder="选择业务部负责人" options={employeeOptions} optionFilterProp="label" />
          </Form.Item>
          <Form.Item label="交付日期" name="delivery_date">
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item label="发货情况" name="delivery_status">
            <Input placeholder="例如 已出货 / 部分待确认" />
          </Form.Item>
        </div>

        <Divider orientation="left" plain>子项目名称</Divider>
        <Form.List name="items">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {fields.map((field) => (
                <div className="project-item-row" key={field.key}>
                  <Form.Item name={[field.name, 'id']} hidden>
                    <Input />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    name={[field.name, 'name']}
                    rules={[{ required: true, message: '请输入子项目名称' }]}
                    style={{ margin: 0, flex: 1 }}
                  >
                    <Input placeholder="请输入子项目名称" />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate>
                    {({ getFieldValue }) => {
                      const itemId = getFieldValue(['items', field.name, 'id']);
                      return itemId ? null : (
                        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                      );
                    }}
                  </Form.Item>
                </div>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ name: '' })}>
                新增子项目
              </Button>
            </Space>
          )}
        </Form.List>

        <Divider orientation="left" plain>阶段负责人</Divider>
        <div className="project-stage-owner-grid">
          {stageDefinitions.map((stage) => (
            <Form.Item
              key={stage.task_type}
              label={stage.task_name}
              name={['stage_owner_values', stage.task_type]}
              tooltip={stage.owner_department_name || undefined}
            >
              <Select
                allowClear
                showSearch
                placeholder={stage.mixed ? '多个负责人' : '选择负责人'}
                options={ownerOptions}
                optionFilterProp="label"
              />
            </Form.Item>
          ))}
        </div>
      </Form>
    </Modal>
  );
}

function projectToForm(project: ProjectCase): ProjectCaseFormValues {
  return {
    code: project.code ?? null,
    name: project.name,
    category: project.category ?? null,
    customer_name: project.customer_name ?? null,
    business_owner_id: project.business_owner_id ?? null,
    design_owner_id: project.design_owner_id ?? null,
    estimated_weight: project.estimated_weight ?? null,
    delivery_date: project.delivery_date ?? null,
    delivery_status: project.delivery_status ?? null,
    items: project.items?.length ? project.items.map((item) => ({ id: item.id, name: item.name })) : [{ name: '' }],
    stage_owner_values: Object.fromEntries(
      (project.stage_owners ?? []).map((stage) => [stage.task_type, encodeOwnerValue(stage)])
    )
  };
}

function normalizeProjectPayload(values: ProjectCaseFormValues, stages: StageDefinition[]): ProjectCasePayload {
  const items = (values.items ?? [])
    .map((item) => ({ id: item.id ?? null, name: item.name?.trim() ?? '' }))
    .filter((item) => item.name);
  const stageOwners = stages.map((stage) => ({
    task_type: stage.task_type,
    ...decodeOwnerValue(values.stage_owner_values?.[stage.task_type])
  }));
  const designStageOwner = stageOwners.find((stage) => stage.task_type === 'design');
  const designOwner = designStageOwner ? designStageOwner.assignee_id ?? null : values.design_owner_id ?? null;
  return {
    code: values.code ?? null,
    name: values.name,
    category: values.category ?? null,
    customer_name: values.customer_name ?? null,
    business_owner_id: values.business_owner_id ?? null,
    design_owner_id: designOwner,
    estimated_weight: values.estimated_weight ?? null,
    delivery_date: values.delivery_date ?? null,
    delivery_status: values.delivery_status ?? null,
    items,
    stage_owners: stageOwners
  };
}

function encodeOwnerValue(stage: Pick<ProjectStageOwner, 'assignee_id' | 'team_id'>) {
  if (stage.assignee_id) return `employee:${stage.assignee_id}`;
  if (stage.team_id) return `team:${stage.team_id}`;
  return undefined;
}

function decodeOwnerValue(value: string | null | undefined) {
  if (!value) return { assignee_id: null, team_id: null };
  const [type, id] = value.split(':');
  if (type === 'employee') return { assignee_id: id, team_id: null };
  if (type === 'team') return { assignee_id: null, team_id: id };
  return { assignee_id: null, team_id: null };
}

function stageDefinitionsFromColumns(columns: MatrixColumn[]): StageDefinition[] {
  const seen = new Set<string>();
  const stages: StageDefinition[] = [];
  for (const column of columns) {
    if (!column.taskType || !column.group || seen.has(column.taskType)) continue;
    seen.add(column.taskType);
    stages.push({
      task_type: column.taskType,
      task_name: column.group,
      generation_scope: column.taskType === 'design' ? 'case' : 'item',
      sort_order: stages.length + 1
    });
  }
  return stages;
}
