import { CompressOutlined, DeleteOutlined, EditOutlined, ExpandAltOutlined, MinusOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, Card, Divider, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Key, MouseEvent } from 'react';
import { TaskDrawer } from '../../components/drawers/TaskDrawer';
import { ProgressCell } from '../../components/matrix/ProgressCell';
import { createProjectCase, deleteProjectCase, fetchAllMatrix, fetchCases, fetchLookups, fetchProjectCaseManageProfile, updateDeliveryInfo, updateProjectCase } from '../../services/cases';
import type { ProjectCasePayload } from '../../services/cases';
import { getAuthSession } from '../../services/auth';
import type { LookupResponse, MatrixCell, MatrixColumn, MatrixRow, ProjectCase, ProjectStageOwner } from '../../types';

const STAGE_COLORS = ['blue', 'cyan', 'green', 'lime', 'gold', 'orange', 'purple'];
const DELIVERY_STATUS_OPTIONS = [
  { label: '已发货', value: '已发货' },
  { label: '未发货', value: '未发货' },
  { label: '待发货', value: '待发货' },
  { label: '发货中', value: '发货中' },
  { label: '其他', value: '其他' }
];
const DELIVERY_STATUS_COLORS: Record<string, string> = {
  已发货: 'success',
  未发货: 'default',
  待发货: 'warning',
  发货中: 'processing',
  其他: 'purple'
};

type ProjectCaseFormValues = ProjectCasePayload & {
  stage_owner_values?: Record<string, string | null | undefined>;
};

type StageDefinition = Pick<ProjectStageOwner, 'task_type' | 'task_name' | 'generation_scope' | 'sort_order' | 'owner_department_name' | 'assignee_id' | 'team_id' | 'mixed'>;

type DeliveryFormValues = {
  delivery_date?: string | null;
  delivery_status?: string | null;
  delivery_remark?: string | null;
};

type DeliveryEditorTarget = {
  project_case_id: string;
  case_item_id?: string | null;
  title: string;
};

export function CaseMatrixPage() {
  const [form] = Form.useForm<ProjectCaseFormValues>();
  const [deliveryForm] = Form.useForm<DeliveryFormValues>();
  const [openedTaskId, setOpenedTaskId] = useState<string>();
  const [deliveryEditor, setDeliveryEditor] = useState<DeliveryEditorTarget | null>(null);
  const [expandedRowKeys, setExpandedRowKeys] = useState<Key[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<string>();
  const [projectManagementOpen, setProjectManagementOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectCase | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const queryClient = useQueryClient();
  const watchedDeliveryStatus = Form.useWatch('delivery_status', deliveryForm);
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
  const casesQuery = useQuery({ queryKey: ['cases'], queryFn: fetchCases, enabled: canManageProjects });
  const lookupsQuery = useQuery({ queryKey: ['lookups'], queryFn: fetchLookups, enabled: canManageProjects });

  const rows = matrixQuery.data?.rows ?? [];
  const projectRowKeys = useMemo(() => rows.filter((row) => row.row_type === 'project').map((row) => row.row_id ?? row.case_item_id), [rows]);
  const stageDefinitions = useMemo(() => stageDefinitionsFromColumns(matrixQuery.data?.columns ?? []), [matrixQuery.data?.columns]);

  const filteredRows = useMemo(() => filterRows(rows, searchKeyword, deliveryStatusFilter), [rows, searchKeyword, deliveryStatusFilter]);
  const activeExpandedRowKeys = searchKeyword.trim() || deliveryStatusFilter
    ? filteredRows.filter((row) => row.row_type === 'project').map((row) => row.row_id ?? row.case_item_id)
    : expandedRowKeys;
  const hasManualExpandedRows = expandedRowKeys.length > 0;

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
    },
    onError: (error) => message.error(error.message)
  });
  const deliveryMutation = useMutation({
    mutationFn: updateDeliveryInfo,
    onSuccess: async () => {
      message.success('发货信息已更新');
      setDeliveryEditor(null);
      deliveryForm.resetFields();
      await refreshProjectQueries();
    },
    onError: (error) => message.error(error.message)
  });

  const openCreateProject = () => {
    setProjectManagementOpen(false);
    setEditingProject(null);
    form.resetFields();
    form.setFieldsValue({ associated_month: currentMonth(), items: [{ name: '', delivery_date: null, delivery_status: null, delivery_remark: null }] });
    setProjectModalOpen(true);
  };
  const openProjectManagement = () => {
    setProjectManagementOpen(true);
    void casesQuery.refetch();
  };
  const openEditProject = async (projectCaseId: string) => {
    setProjectManagementOpen(false);
    setProfileLoading(true);
    try {
      const project = await fetchProjectCaseManageProfile(projectCaseId);
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
  const openDeliveryEditor = (row: MatrixRow) => {
    if (!canManageProjects || row.row_type !== 'item') return;
    const title = String(row.cells.project_item_name?.value ?? row.cells.case_item_name?.value ?? '子项目');
    setDeliveryEditor({
      project_case_id: row.project_case_id,
      case_item_id: row.case_item_id,
      title
    });
    deliveryForm.setFieldsValue({
      delivery_date: stringCellValue(row.cells.delivery_date),
      delivery_status: stringCellValue(row.cells.delivery_status),
      delivery_remark: row.cells.delivery_status?.deliveryRemark ?? null
    });
  };
  const submitDeliveryForm = (values: DeliveryFormValues) => {
    if (!deliveryEditor) return;
    deliveryMutation.mutate({
      ...deliveryEditor,
      delivery_date: values.delivery_date ?? null,
      delivery_status: values.delivery_status ?? null,
      delivery_remark: values.delivery_status === '其他' ? values.delivery_remark ?? null : null
    });
  };

  const tableColumns = useMemo(
    () => buildColumns(matrixQuery.data?.columns ?? [], setOpenedTaskId, canManageProjects, openDeliveryEditor, openEditProject, deliveryStatusFilter),
    [matrixQuery.data?.columns, canManageProjects, deliveryStatusFilter]
  );
  const handleTableChange: TableProps<MatrixRow>['onChange'] = (_pagination, filters) => {
    const next = Array.isArray(filters.delivery_status) ? filters.delivery_status[0] : undefined;
    setDeliveryStatusFilter(typeof next === 'string' ? next : undefined);
  };

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
            <Button
              icon={hasManualExpandedRows ? <CompressOutlined /> : <ExpandAltOutlined />}
              onClick={() => setExpandedRowKeys(hasManualExpandedRows ? [] : projectRowKeys)}
            >
              {hasManualExpandedRows ? '折叠' : '展开'}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => matrixQuery.refetch()}>
              刷新
            </Button>
            {canManageProjects && (
              <Button type="primary" icon={<SettingOutlined />} onClick={openProjectManagement}>
                项目管理
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
          scroll={{ x: 2700, y: 'calc(100vh - 178px)' }}
          onChange={handleTableChange}
          expandable={{
            expandedRowKeys: activeExpandedRowKeys,
            onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys]),
            indentSize: 14,
            expandIcon: (props) => (
              <MatrixExpandIcon
                {...props}
                canManageProjects={canManageProjects}
                deleteLoading={deleteMutation.isPending}
                onDelete={(row) => deleteMutation.mutate(row.project_case_id)}
              />
            )
          }}
          rowClassName={(row) => {
            const classes = [
              row.row_type === 'month'
                ? 'matrix-month-row'
                : row.row_type === 'project'
                  ? 'matrix-project-row'
                  : 'matrix-item-row'
            ];
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
      <Modal
        title={`编辑发货信息 - ${deliveryEditor?.title ?? ''}`}
        open={Boolean(deliveryEditor)}
        onCancel={() => {
          setDeliveryEditor(null);
          deliveryForm.resetFields();
        }}
        onOk={() => deliveryForm.submit()}
        okText="保存"
        confirmLoading={deliveryMutation.isPending}
        destroyOnClose
      >
        <Form form={deliveryForm} layout="vertical" onFinish={submitDeliveryForm}>
          <Form.Item label="发货时间" name="delivery_date">
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item label="发货情况" name="delivery_status">
            <Select allowClear placeholder="请选择发货情况" options={DELIVERY_STATUS_OPTIONS} />
          </Form.Item>
          {watchedDeliveryStatus === '其他' && (
            <Form.Item label="备注" name="delivery_remark">
              <Input.TextArea placeholder="补充说明其他发货情况" autoSize={{ minRows: 2, maxRows: 4 }} />
            </Form.Item>
          )}
        </Form>
      </Modal>
      <ProjectManagementModal
        open={projectManagementOpen}
        projects={casesQuery.data ?? []}
        loading={casesQuery.isLoading || casesQuery.isFetching}
        deleteLoading={deleteMutation.isPending}
        onCancel={() => setProjectManagementOpen(false)}
        onCreate={openCreateProject}
        onEdit={(project) => openEditProject(project.id)}
        onDelete={(project) => deleteMutation.mutate(project.id)}
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

type MatrixExpandIconProps = {
  expanded: boolean;
  record: MatrixRow;
  onExpand: (record: MatrixRow, event: MouseEvent<HTMLElement>) => void;
  canManageProjects: boolean;
  deleteLoading: boolean;
  onDelete: (row: MatrixRow) => void;
};

function MatrixExpandIcon({
  expanded,
  record,
  onExpand,
  canManageProjects,
  deleteLoading,
  onDelete
}: MatrixExpandIconProps) {
  if (record.row_type !== 'project') {
    return <span className="matrix-expand-spacer" />;
  }

  const projectName = String(record.cells.case_name?.value ?? '项目');
  const hasChildren = Boolean(record.children?.length);

  return (
    <span className="matrix-row-action-stack">
      {hasChildren ? (
        <Tooltip title={expanded ? '折叠子项目' : '展开子项目'}>
          <Button
            type="text"
            size="small"
            className="matrix-row-action-button"
            icon={expanded ? <MinusOutlined /> : <PlusOutlined />}
            aria-label={expanded ? '折叠子项目' : '展开子项目'}
            onClick={(event) => onExpand(record, event)}
          />
        </Tooltip>
      ) : (
        <span className="matrix-row-action-placeholder" />
      )}
      {canManageProjects && (
        <Popconfirm
          title="删除项目"
          description={`确认删除「${projectName}」？会同时删除子项目、任务、日报和异常。`}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true, loading: deleteLoading }}
          onConfirm={() => onDelete(record)}
        >
          <Button
            type="text"
            size="small"
            danger
            className="matrix-row-action-button"
            icon={<DeleteOutlined />}
            aria-label="删除项目"
            loading={deleteLoading}
            onClick={(event) => event.stopPropagation()}
          />
        </Popconfirm>
      )}
    </span>
  );
}

function buildColumns(
  columns: MatrixColumn[],
  openTask: (taskId: string) => void,
  canManageProjects: boolean,
  onEditDelivery: (row: MatrixRow) => void,
  onEditProject: (projectCaseId: string) => void,
  deliveryStatusFilter?: string
): ColumnsType<MatrixRow> {
  const leftColumns = columns
    .filter((column) => column.frozen === 'left')
    .map((column) => ({
      title: column.title,
      dataIndex: column.key,
      key: column.key,
      fixed: 'left' as const,
      width: column.key === 'project_item_name' ? 380 : column.key === 'case_name' ? 250 : 190,
      className: `matrix-fixed-left matrix-column-${column.key}`,
      render: (_value: unknown, row: MatrixRow) => renderPinnedCell(column.key, row, { canManageProjects, onEditProject })
    }));

  const rightColumns = columns
    .filter((column) => column.frozen === 'right')
    .map((column) => ({
      title: column.title,
      dataIndex: column.key,
      key: column.key,
      fixed: 'right' as const,
      width: 70,
      className: 'matrix-fixed-right',
      render: (_value: unknown, row: MatrixRow) => renderPinnedCell(column.key, row, { canManageProjects, onEditProject })
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
      children: children.map((child) => {
        const column = {
          title: child.title,
          key: child.key,
          width: matrixColumnWidth(child),
          align: isPlainMatrixColumn(child) ? 'left' as const : 'center' as const,
          className: `matrix-stage-cell stage-${stageColor}`,
          onHeaderCell: () => ({ className: `matrix-substage-header stage-${stageColor}` }),
          onCell: () => ({ className: `matrix-stage-cell stage-${stageColor}` }),
          render: (_value: unknown, row: MatrixRow) => {
            if (row.row_type === 'month') return <span className="matrix-month-spacer" />;
            return isPlainMatrixColumn(child)
              ? <DeliveryInfoCell columnKey={child.key} row={row} editable={canManageProjects} onEdit={onEditDelivery} />
              : <ProgressCell cell={row.cells[child.key]} onOpenTask={openTask} />;
          }
        };
        if (child.key !== 'delivery_status') return column;
        return {
          ...column,
          filters: DELIVERY_STATUS_OPTIONS.map((option) => ({ text: option.label, value: option.value })),
          filteredValue: deliveryStatusFilter ? [deliveryStatusFilter] : null,
          filterMultiple: false,
          onFilter: () => true
        };
      })
    };
  });

  return [...leftColumns, ...groupedColumns, ...rightColumns];
}

function isPlainMatrixColumn(column: MatrixColumn) {
  return column.key === 'delivery_date' || column.key === 'delivery_status';
}

function matrixColumnWidth(column: MatrixColumn) {
  if (column.key === 'delivery_date') return 112;
  if (column.key === 'delivery_status') return 126;
  return 96;
}

function renderPinnedCell(
  key: string,
  row: MatrixRow,
  context: { canManageProjects: boolean; onEditProject: (projectCaseId: string) => void }
) {
  const cell = row.cells[key];
  const value = cell?.value;
  if (key === 'open_exception_count') {
    const count = Number(value ?? 0);
    return count > 0 ? <Tag color="red">{count}</Tag> : <span className="empty-cell">0</span>;
  }
  if (key === 'project_item_name') {
    if (row.row_type === 'month') {
      const meta = stringCellValue(row.cells.case_item_name) ?? '';
      return (
        <Space direction="vertical" size={0} className="matrix-row-title">
          <Typography.Text strong className="matrix-month-title">{value ? String(value) : '未分类'}</Typography.Text>
          {meta && <Typography.Text type="secondary" className="matrix-month-meta">{meta}</Typography.Text>}
        </Space>
      );
    }
    const text = value ? String(value) : '-';
    const shipped = stringCellValue(row.cells.delivery_status) === '已发货';
    const secondary = row.row_type === 'project'
      ? [cell?.ownerName, typeof cell?.aggregateCount === 'number' ? `${cell.aggregateCount} 个子项目` : null].filter(Boolean).join(' · ')
      : typeof cell?.aggregateCount === 'number'
        ? `${cell.aggregateCount}%`
        : '';
    return (
      <Space direction="vertical" size={0} className="matrix-row-title">
        <div className="matrix-project-title-line">
          {shipped && <Tag color="success" className="matrix-shipped-tag">已发货</Tag>}
          {row.row_type === 'project' && context.canManageProjects ? (
            <ProjectTitleButton text={text} onClick={() => context.onEditProject(row.project_case_id)} />
          ) : (
            <EllipsisText text={text} strong={row.row_type === 'project'} />
          )}
        </div>
        {secondary && <EllipsisText text={secondary} type="secondary" />}
      </Space>
    );
  }
  if (key === 'case_name') {
    if (row.row_type === 'month') {
      return <Typography.Text strong className="matrix-month-title">{value ? String(value) : '未分类'}</Typography.Text>;
    }
    const text = value ? String(value) : row.row_type === 'item' ? '' : '-';
    return (
      <Space direction="vertical" size={0} className="matrix-row-title">
        <div className="matrix-project-title-line">
          {row.row_type === 'project' && context.canManageProjects ? (
            <ProjectTitleButton text={text} onClick={() => context.onEditProject(row.project_case_id)} />
          ) : (
            <EllipsisText text={text} strong={row.row_type === 'project'} />
          )}
        </div>
        {row.row_type === 'project' && cell?.ownerName && (
          <EllipsisText text={cell.ownerName} type="secondary" />
        )}
      </Space>
    );
  }
  if (key === 'case_item_name') {
    if (row.row_type === 'month') {
      return <Typography.Text type="secondary" className="matrix-month-meta">{value ? String(value) : '-'}</Typography.Text>;
    }
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

function DeliveryInfoCell({
  columnKey,
  row,
  editable,
  onEdit
}: {
  columnKey: string;
  row: MatrixRow;
  editable: boolean;
  onEdit: (row: MatrixRow) => void;
}) {
  const cell = row.cells[columnKey];
  const value = cell?.value;
  const content = columnKey === 'delivery_status'
    ? <DeliveryStatusDisplay status={value ? String(value) : ''} remark={cell?.deliveryRemark ?? null} />
    : value
      ? <EllipsisText text={String(value)} />
      : <span className="empty-cell">-</span>;
  const canEditCell = editable && row.row_type === 'item';
  if (!canEditCell) return content;
  return (
    <Tooltip title="点击编辑发货信息">
      <button type="button" className="matrix-editable-text-cell" onClick={() => onEdit(row)}>
        {content}
      </button>
    </Tooltip>
  );
}

function DeliveryStatusDisplay({ status, remark }: { status: string; remark?: string | null }) {
  if (!status) return <span className="empty-cell">-</span>;
  const tag = <Tag color={DELIVERY_STATUS_COLORS[status] ?? 'default'}>{status}</Tag>;
  if (status === '其他' && remark) {
    return <Tooltip title={remark}>{tag}</Tooltip>;
  }
  return tag;
}

function stringCellValue(cell: MatrixCell | undefined) {
  const value = cell?.value;
  return value === null || value === undefined ? null : String(value);
}

function ProjectTitleButton({ text, onClick }: { text: string; onClick: () => void }) {
  const content = (
    <button type="button" className="matrix-project-title-button" onClick={onClick}>
      <Typography.Text strong className="matrix-ellipsis-text">
        {text}
      </Typography.Text>
    </button>
  );
  if (!text || text === '-') return content;
  return <Tooltip title={`${text}（点击编辑）`}>{content}</Tooltip>;
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

function filterRows(rows: MatrixRow[], keyword: string, deliveryStatus?: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword && !deliveryStatus) return rows;
  const matchedRows: MatrixRow[] = [];
  let currentMonthRow: MatrixRow | null = null;
  let currentMonthMatched = false;
  const appendMonthIfNeeded = () => {
    if (!currentMonthRow || currentMonthMatched) return;
    matchedRows.push(currentMonthRow);
    currentMonthMatched = true;
  };
  for (const row of rows) {
    if (row.row_type === 'month') {
      currentMonthRow = row;
      currentMonthMatched = false;
      continue;
    }
    const children = row.children?.filter((child) => rowMatches(child, normalizedKeyword) && rowMatchesDeliveryStatus(child, deliveryStatus)) ?? [];
    const rowMatched = rowMatches(row, normalizedKeyword) && rowMatchesDeliveryStatus(row, deliveryStatus);
    if (rowMatched || children.length > 0) {
      appendMonthIfNeeded();
      matchedRows.push({ ...row, children: children.length > 0 ? children : row.children });
    }
  }
  return matchedRows;
}

function rowMatches(row: MatrixRow, keyword: string) {
  if (!keyword) return true;
  return Object.values(row.cells).some((cell: MatrixCell) => {
    const values = [cell.value, cell.ownerName, cell.departmentName, cell.deliveryRemark];
    return values.some((value) => String(value ?? '').toLowerCase().includes(keyword));
  });
}

function rowMatchesDeliveryStatus(row: MatrixRow, deliveryStatus?: string) {
  if (!deliveryStatus) return true;
  return stringCellValue(row.cells.delivery_status) === deliveryStatus;
}

type ProjectManagementModalProps = {
  open: boolean;
  projects: ProjectCase[];
  loading: boolean;
  deleteLoading: boolean;
  onCancel: () => void;
  onCreate: () => void;
  onEdit: (project: ProjectCase) => void;
  onDelete: (project: ProjectCase) => void;
};

function ProjectManagementModal({
  open,
  projects,
  loading,
  deleteLoading,
  onCancel,
  onCreate,
  onEdit,
  onDelete
}: ProjectManagementModalProps) {
  const columns: ColumnsType<ProjectCase> = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      render: (value: string) => <EllipsisText text={value || '-'} strong />
    },
    {
      title: '关联年月',
      dataIndex: 'associated_month',
      key: 'associated_month',
      width: 96,
      render: (value: string | null) => value || '-'
    },
    {
      title: '操作',
      key: 'actions',
      width: 132,
      align: 'right',
      render: (_value, project) => (
        <Space size={4}>
          <Tooltip title="编辑基础信息">
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              aria-label="编辑基础信息"
              onClick={() => onEdit(project)}
            />
          </Tooltip>
          <Popconfirm
            title="删除项目"
            description="会同时删除项目下的子项目、任务、日报和异常，确认删除？"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: deleteLoading }}
            onConfirm={() => onDelete(project)}
          >
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="删除项目"
            />
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Modal
      title="项目管理"
      open={open}
      onCancel={onCancel}
      footer={null}
      width={720}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div className="project-management-toolbar">
          <Typography.Text type="secondary">{projects.length} 个项目</Typography.Text>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            新增项目
          </Button>
        </div>
        <Table<ProjectCase>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={projects}
          pagination={false}
          size="small"
          scroll={{ y: 520 }}
          className="project-management-table"
        />
      </Space>
    </Modal>
  );
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
          <Form.Item
            label="关联年月"
            name="associated_month"
            rules={[{ pattern: /^\d{4}-(0[1-9]|1[0-2])$/, message: '请输入 YYYY-MM 格式' }]}
          >
            <Input placeholder="例如 2026-04" />
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
        </div>

        <Divider orientation="left" plain>子项目发货信息</Divider>
        <Form.List name="items">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <div className="project-item-header">
                <Typography.Text type="secondary">子项目名称</Typography.Text>
                <Typography.Text type="secondary">发货时间</Typography.Text>
                <Typography.Text type="secondary">发货情况</Typography.Text>
                <Typography.Text type="secondary">备注</Typography.Text>
              </div>
              {fields.map((field) => (
                <div className="project-item-row" key={field.key}>
                  <Form.Item name={[field.name, 'id']} hidden>
                    <Input />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    name={[field.name, 'name']}
                    rules={[{ required: true, message: '请输入子项目名称' }]}
                    style={{ margin: 0 }}
                  >
                    <Input placeholder="请输入子项目名称" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'delivery_date']} style={{ margin: 0 }}>
                    <Input placeholder="YYYY-MM-DD" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'delivery_status']} style={{ margin: 0 }}>
                    <Select allowClear placeholder="发货情况" options={DELIVERY_STATUS_OPTIONS} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'delivery_remark']} style={{ margin: 0 }}>
                    <Input placeholder="其他备注" />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate>
                    {({ getFieldValue }) => {
                      const itemId = getFieldValue(['items', field.name, 'id']);
                      if (itemId) {
                        return (
                          <Popconfirm
                            title="删除子项目"
                            description="保存项目后会删除该子项目及关联任务、日报和异常，确认先从表单移除？"
                            okText="移除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => remove(field.name)}
                          >
                            <Button type="text" danger icon={<DeleteOutlined />} aria-label="删除子项目" />
                          </Popconfirm>
                        );
                      }
                      return (
                        <Button type="text" danger icon={<DeleteOutlined />} aria-label="删除子项目" onClick={() => remove(field.name)} />
                      );
                    }}
                  </Form.Item>
                </div>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ name: '', delivery_date: null, delivery_status: null, delivery_remark: null })}>
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
    associated_month: project.associated_month ?? null,
    customer_name: project.customer_name ?? null,
    business_owner_id: project.business_owner_id ?? null,
    design_owner_id: project.design_owner_id ?? null,
    estimated_weight: project.estimated_weight ?? null,
    delivery_date: project.delivery_date ?? null,
    items: project.items?.length
      ? project.items.map((item) => ({
          id: item.id,
          name: item.name,
          delivery_date: item.delivery_date ?? null,
          delivery_status: item.delivery_status ?? null,
          delivery_remark: item.delivery_remark ?? null
        }))
      : [{ name: '', delivery_date: null, delivery_status: null, delivery_remark: null }],
    stage_owner_values: Object.fromEntries(
      (project.stage_owners ?? []).map((stage) => [stage.task_type, encodeOwnerValue(stage)])
    )
  };
}

function normalizeProjectPayload(values: ProjectCaseFormValues, stages: StageDefinition[]): ProjectCasePayload {
  const items = (values.items ?? [])
    .map((item) => ({
      id: item.id ?? null,
      name: item.name?.trim() ?? '',
      delivery_date: item.delivery_date ?? null,
      delivery_status: item.delivery_status ?? null,
      delivery_remark: item.delivery_status === '其他' ? item.delivery_remark ?? null : null
    }))
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
    associated_month: values.associated_month ?? null,
    customer_name: values.customer_name ?? null,
    business_owner_id: values.business_owner_id ?? null,
    design_owner_id: designOwner,
    estimated_weight: values.estimated_weight ?? null,
    delivery_date: values.delivery_date ?? null,
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

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
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
