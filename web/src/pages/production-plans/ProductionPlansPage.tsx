import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Progress, Row, Select, Space, Statistic, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';
import {
  createProductionPlanItem,
  deleteProductionPlanItem,
  fetchProductionPlanBoard,
  updateProductionPlanItem
} from '../../services/productionPlans';
import type { ProductionPlanBoardFilters } from '../../services/productionPlans';
import type { ProductionPlanBacklogItem, ProductionPlanItem } from '../../types';

const STATUS_LABELS: Record<string, string> = {
  planned: '计划中',
  in_progress: '进行中',
  completed: '已完成',
  delayed: '已延期',
  cancelled: '已取消',
  not_started: '未开始'
};

const STATUS_COLORS: Record<string, string> = {
  planned: 'blue',
  in_progress: 'green',
  completed: 'default',
  delayed: 'red',
  cancelled: 'default',
  not_started: 'default'
};

const GANTT_DAY_WIDTH = 34;
const GANTT_ROW_HEIGHT = 38;

type ScheduleFormValues = {
  name: string;
  dates: [Dayjs, Dayjs];
  assigned_team_id?: string | null;
  progress?: number;
  remark?: string;
};

export function ProductionPlansPage() {
  const [filters, setFilters] = useState<ProductionPlanBoardFilters>({});
  const [keyword, setKeyword] = useState('');
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [scheduleForm] = Form.useForm<ScheduleFormValues>();
  const [selectedBacklog, setSelectedBacklog] = useState<ProductionPlanBacklogItem | null>(null);
  const [editingItem, setEditingItem] = useState<ProductionPlanItem | null>(null);
  const queryClient = useQueryClient();

  const boardQuery = useQuery({
    queryKey: ['production-plan-board', filters],
    queryFn: () => fetchProductionPlanBoard(filters)
  });
  const board = boardQuery.data;
  const plan = board?.plan;

  const filteredBacklog = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    const rows = board?.backlog_items ?? [];
    if (!normalized) return rows;
    return rows.filter((row) =>
      [row.project_case_name, row.case_item_name, row.task_name, row.team_name, row.assignee_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    );
  }, [board?.backlog_items, keyword]);

  const refreshBoard = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['production-plan-board'] }),
      queryClient.invalidateQueries({ queryKey: ['matrix', 'all'] })
    ]);
  };

  const createMutation = useMutation({
    mutationFn: createProductionPlanItem,
    onSuccess: async () => {
      message.success('已加入排期');
      closeScheduleModal();
      await refreshBoard();
    },
    onError: (error) => message.error(error.message)
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateProductionPlanItem>[1] }) =>
      updateProductionPlanItem(id, payload),
    onSuccess: async () => {
      message.success('排期已更新');
      closeScheduleModal();
      await refreshBoard();
    },
    onError: (error) => message.error(error.message)
  });
  const deleteMutation = useMutation({
    mutationFn: deleteProductionPlanItem,
    onSuccess: async () => {
      message.success('已撤销排期');
      await refreshBoard();
    },
    onError: (error) => message.error(error.message)
  });

  const openCreateSchedule = (backlog: ProductionPlanBacklogItem) => {
    const dates = defaultScheduleDates(plan?.start_date);
    setBacklogOpen(false);
    setEditingItem(null);
    setSelectedBacklog(backlog);
    scheduleForm.setFieldsValue({
      name: backlog.task_name,
      dates,
      assigned_team_id: backlog.team_id ?? undefined,
      progress: Math.round(Number(backlog.progress ?? 0)),
      remark: ''
    });
  };

  const openEditSchedule = (item: ProductionPlanItem) => {
    setSelectedBacklog(null);
    setEditingItem(item);
    scheduleForm.setFieldsValue({
      name: item.name,
      dates: [dayjs(item.planned_start_date), dayjs(item.planned_end_date)],
      assigned_team_id: item.assigned_team_id ?? undefined,
      progress: Math.round(Number(item.progress ?? 0)),
      remark: item.remark ?? ''
    });
  };

  const closeScheduleModal = () => {
    setSelectedBacklog(null);
    setEditingItem(null);
    scheduleForm.resetFields();
  };

  const submitSchedule = (values: ScheduleFormValues) => {
    const [start, end] = values.dates;
    const payload = {
      name: values.name,
      planned_start_date: start.format('YYYY-MM-DD'),
      planned_end_date: end.format('YYYY-MM-DD'),
      assigned_team_id: values.assigned_team_id ?? null,
      progress: values.progress ?? 0,
      remark: values.remark ?? ''
    };
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, payload });
      return;
    }
    if (!selectedBacklog) return;
    createMutation.mutate({
      ...payload,
      case_task_id: selectedBacklog.task_id,
      department_id: plan?.department_id ?? selectedBacklog.owner_department_id,
      month: plan?.plan_month ?? start.format('YYYY-MM')
    });
  };

  const ganttColumns = useMemo(
    () => buildGanttColumns(board?.dates ?? [], openEditSchedule, (item) => deleteMutation.mutate(item.id)),
    [board?.dates, deleteMutation]
  );
  const timelineWidth = Math.max((board?.dates.length ?? 0) * GANTT_DAY_WIDTH, 320);
  const scrollX = 52 + 280 + timelineWidth + 390;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="page-toolbar">
        <div className="page-title-row">
          <Space direction="vertical" size={0}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              生产计划
            </Typography.Title>
            <Typography.Text type="secondary">
              {plan ? `${plan.department_name} / ${plan.plan_month}` : '先从待排期任务池生成部门甘特图'}
            </Typography.Text>
          </Space>
          <Space wrap>
            <Select
              allowClear
              showSearch
              placeholder="部门"
              value={filters.department_id}
              options={(board?.filters.departments ?? []).map((item) => ({ value: item.id, label: item.name }))}
              optionFilterProp="label"
              style={{ width: 140 }}
              onChange={(value) => setFilters((current) => ({ ...current, department_id: value }))}
            />
            <Select
              allowClear
              placeholder="月份"
              value={filters.month}
              options={(board?.filters.months ?? []).map((month) => ({ value: month, label: month }))}
              style={{ width: 120 }}
              onChange={(value) => setFilters((current) => ({ ...current, month: value }))}
            />
            <Select
              allowClear
              showSearch
              placeholder="班组"
              value={filters.team_id}
              options={(board?.filters.teams ?? []).map((item) => ({ value: item.id, label: item.name }))}
              optionFilterProp="label"
              style={{ width: 130 }}
              onChange={(value) => setFilters((current) => ({ ...current, team_id: value }))}
            />
            <Select
              allowClear
              showSearch
              prefix={<SearchOutlined />}
              placeholder="关联项目"
              value={filters.project_case_id}
              options={(board?.filters.projects ?? []).map((item) => ({ value: item.id, label: item.name }))}
              optionFilterProp="label"
              style={{ width: 260 }}
              onChange={(value) => setFilters((current) => ({ ...current, project_case_id: value }))}
            />
            <Button icon={<ReloadOutlined />} onClick={() => boardQuery.refetch()}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setBacklogOpen(true)}>
              待排期任务池 {board?.summary.backlog_count ?? 0}
            </Button>
          </Space>
        </div>
      </Card>

      <Row gutter={12}>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="待排期" value={board?.summary.backlog_count ?? 0} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="已排期" value={board?.summary.item_count ?? 0} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="排产天数" value={board?.summary.scheduled_days ?? 0} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="已完成" value={board?.summary.completed_count ?? 0} /></Card></Col>
      </Row>

      <Card
        className="production-plan-card"
        title="排期甘特图"
        extra={
          <Space size={4} wrap className="gantt-legend">
            <Tag color="green">装焊</Tag>
            <Tag color="cyan">下料</Tag>
            <Tag color="purple">喷涂</Tag>
            <Tag color="blue">发货</Tag>
          </Space>
        }
      >
        <Table<ProductionPlanItem>
          rowKey="id"
          loading={boardQuery.isLoading}
          columns={ganttColumns}
          dataSource={board?.items ?? []}
          pagination={false}
          size="small"
          bordered
          sticky
          tableLayout="fixed"
          scroll={{ x: scrollX, y: 'calc(100vh - 286px)' }}
          rowClassName={(row) => `production-plan-row status-${row.effective_status}`}
        />
      </Card>

      <Modal
        title={
          <Space>
            <span>待排期任务池</span>
            <Tag color="blue">{filteredBacklog.length}</Tag>
          </Space>
        }
        open={backlogOpen}
        width={1040}
        footer={null}
        onCancel={() => setBacklogOpen(false)}
        destroyOnClose
      >
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索项目 / 子项目 / 阶段 / 负责人"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          style={{ marginBottom: 10 }}
        />
        <Table<ProductionPlanBacklogItem>
          rowKey="task_id"
          className="schedule-backlog-modal-table"
          size="small"
          loading={boardQuery.isLoading}
          dataSource={filteredBacklog}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ y: '52vh' }}
          columns={buildBacklogColumns(openCreateSchedule)}
        />
      </Modal>

      <Modal
        title={editingItem ? '编辑排期活动' : '新增排期活动'}
        open={Boolean(selectedBacklog || editingItem)}
        onCancel={closeScheduleModal}
        onOk={() => scheduleForm.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        destroyOnClose
      >
        <Form form={scheduleForm} layout="vertical" onFinish={submitSchedule}>
          <Form.Item label="活动名称" name="name" rules={[{ required: true, message: '请输入活动名称' }]}>
            <Input placeholder="例如：外侧模1装焊完毕" />
          </Form.Item>
          <Form.Item label="排期时间" name="dates" rules={[{ required: true, message: '请选择排期时间' }]}>
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="施工班组" name="assigned_team_id">
            <Select
              allowClear
              showSearch
              placeholder="选择班组"
              optionFilterProp="label"
              options={(board?.filters.teams ?? []).map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item label="完成度" name="progress">
            <InputNumber min={0} max={100} addonAfter="%" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} placeholder="可记录排期说明、风险或现场备注" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function buildGanttColumns(
  dates: string[],
  onEdit: (item: ProductionPlanItem) => void,
  onDelete: (item: ProductionPlanItem) => void
): ColumnsType<ProductionPlanItem> {
  const timelineWidth = Math.max(dates.length * GANTT_DAY_WIDTH, 320);

  return [
    {
      title: '序号',
      dataIndex: 'sort_order',
      key: 'sort_order',
      fixed: 'left',
      width: 52,
      align: 'center'
    },
    {
      title: '排期任务',
      key: 'schedule',
      fixed: 'left',
      width: 280,
      render: (_value, row) => (
        <Tooltip title={<ScheduleDetail row={row} />} placement="right">
          <Space direction="vertical" size={0} className="production-plan-title-cell">
            <Typography.Text strong className="matrix-ellipsis-text">{row.name}</Typography.Text>
            <Typography.Text type="secondary" className="matrix-ellipsis-text production-plan-meta">
              {compactScheduleSummary(row)}
            </Typography.Text>
          </Space>
        </Tooltip>
      )
    },
    {
      title: <TimelineHeader dates={dates} />,
      key: 'timeline',
      width: timelineWidth,
      className: 'gantt-timeline-cell',
      onHeaderCell: () => ({ className: 'gantt-timeline-header' }),
      render: (_value, row) => <GanttTimeline dates={dates} row={row} />
    },
    {
      title: '工期',
      dataIndex: 'duration_days',
      key: 'duration_days',
      fixed: 'right',
      width: 70,
      align: 'center',
      render: (value: number) => `${value}天`
    },
    {
      title: '班组',
      dataIndex: 'assigned_team_name',
      key: 'assigned_team_name',
      fixed: 'right',
      width: 86,
      render: (value: string | null) => value || '-'
    },
    {
      title: '完成度',
      dataIndex: 'progress',
      key: 'progress',
      fixed: 'right',
      width: 104,
      render: (value: number) => <Progress percent={Math.round(Number(value ?? 0))} size="small" />
    },
    {
      title: '状态',
      dataIndex: 'effective_status',
      key: 'effective_status',
      fixed: 'right',
      width: 84,
      render: (value: string) => <Tag color={STATUS_COLORS[value] ?? 'default'}>{STATUS_LABELS[value] ?? value}</Tag>
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 96,
      align: 'center',
      render: (_value, row) => (
        <Space size={4}>
          <Tooltip title="编辑排期">
            <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(row)} />
          </Tooltip>
          <Popconfirm title="撤销这条排期？" okText="撤销" cancelText="取消" onConfirm={() => onDelete(row)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];
}

function buildBacklogColumns(onSchedule: (item: ProductionPlanBacklogItem) => void): ColumnsType<ProductionPlanBacklogItem> {
  return [
    {
      title: '项目',
      key: 'project',
      width: 280,
      render: (_value, row) => (
        <Space direction="vertical" size={0} className="schedule-backlog-item">
          <Tooltip title={row.project_case_name}>
            <Typography.Text strong className="matrix-ellipsis-text">{row.project_case_name}</Typography.Text>
          </Tooltip>
          <Tooltip title={row.case_item_name ?? '-'}>
            <Typography.Text type="secondary" className="matrix-ellipsis-text">
              {row.case_item_name ?? '-'}
            </Typography.Text>
          </Tooltip>
        </Space>
      )
    },
    {
      title: '阶段',
      dataIndex: 'task_name',
      width: 120,
      render: (value: string) => <Tag color="geekblue">{value}</Tag>
    },
    {
      title: '负责人 / 班组',
      key: 'owner',
      width: 170,
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{row.assignee_name ?? row.team_name ?? '-'}</Typography.Text>
          <Typography.Text type="secondary" className="production-plan-meta">
            {row.owner_department_name ?? '-'}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '当前进度',
      dataIndex: 'progress',
      width: 150,
      render: (value: number) => <Progress percent={Math.round(Number(value ?? 0))} size="small" />
    },
    {
      title: '异常',
      dataIndex: 'open_exception_count',
      width: 80,
      align: 'center',
      render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : <Typography.Text type="secondary">0</Typography.Text>
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      align: 'center',
      render: (_value, row) => (
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => onSchedule(row)}>
          排期
        </Button>
      )
    }
  ];
}

function compactScheduleSummary(row: ProductionPlanItem) {
  return [row.project_case_name, row.case_item_name, row.task_name].filter(Boolean).join(' / ') || '-';
}

function ScheduleDetail({ row }: { row: ProductionPlanItem }) {
  const progress = Math.round(Number(row.progress ?? 0));
  return (
    <div className="schedule-detail-tooltip">
      <div className="schedule-detail-title">{row.name}</div>
      <div><span>项目：</span>{row.project_case_name ?? '-'}</div>
      <div><span>子项目：</span>{row.case_item_name ?? '-'}</div>
      <div><span>阶段：</span>{row.task_name ?? '-'}</div>
      <div><span>排期：</span>{row.planned_start_date} 至 {row.planned_end_date}，{row.duration_days}天</div>
      <div><span>班组：</span>{row.assigned_team_name ?? '-'}</div>
      <div><span>进度：</span>{progress}%</div>
      <div><span>状态：</span>{STATUS_LABELS[row.effective_status] ?? row.effective_status}</div>
      {row.remark ? <div><span>备注：</span>{row.remark}</div> : null}
    </div>
  );
}

function TimelineHeader({ dates }: { dates: string[] }) {
  if (dates.length === 0) return <span>时间轴</span>;
  const monthLabel = dayjs(dates[0]).format('YYYY年M月');
  return (
    <div className="gantt-header" style={{ width: dates.length * GANTT_DAY_WIDTH }}>
      <div className="gantt-month-label">{monthLabel}</div>
      <div className="gantt-day-grid" style={{ gridTemplateColumns: `repeat(${dates.length}, ${GANTT_DAY_WIDTH}px)` }}>
        {dates.map((date) => {
          const day = dayjs(date);
          const isWeekend = [0, 6].includes(day.day());
          return (
            <div key={date} className={isWeekend ? 'gantt-day-header is-weekend' : 'gantt-day-header'}>
              <span>{day.date()}</span>
              <small>{day.format('dd')}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GanttTimeline({ dates, row }: { dates: string[]; row: ProductionPlanItem }) {
  const width = Math.max(dates.length * GANTT_DAY_WIDTH, 320);
  if (dates.length === 0) {
    return <div className="gantt-row-track empty">暂无日期</div>;
  }
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  if (row.planned_end_date < firstDate || row.planned_start_date > lastDate) {
    return (
      <Tooltip title={`${row.name}：${row.planned_start_date} 至 ${row.planned_end_date}`}>
        <div className="gantt-row-track empty" style={{ width, height: GANTT_ROW_HEIGHT }}>
          超出当前月份
        </div>
      </Tooltip>
    );
  }
  const startDate = row.planned_start_date < firstDate ? firstDate : row.planned_start_date;
  const endDate = row.planned_end_date > lastDate ? lastDate : row.planned_end_date;
  const startIndex = Math.max(0, dates.findIndex((date) => date >= startDate));
  const endIndex = Math.max(startIndex, dates.findIndex((date) => date >= endDate));
  const duration = Math.max(endIndex - startIndex + 1, 1);
  const left = startIndex * GANTT_DAY_WIDTH + 3;
  const barWidth = duration * GANTT_DAY_WIDTH - 6;
  const progress = Math.max(0, Math.min(100, Math.round(Number(row.progress ?? 0))));
  const title = `${row.name}：${row.planned_start_date} 至 ${row.planned_end_date}，完成 ${progress}%`;
  return (
    <Tooltip title={title}>
      <div className="gantt-row-track" style={{ width, height: GANTT_ROW_HEIGHT }}>
        <div className="gantt-grid-lines">
          {dates.map((date) => (
            <span key={date} className={[0, 6].includes(dayjs(date).day()) ? 'is-weekend' : ''} />
          ))}
        </div>
        <div
          className={[
            'gantt-bar',
            `task-${row.task_type ?? 'default'}`,
            `status-${row.effective_status}`
          ].join(' ')}
          style={{
            left,
            width: Math.max(barWidth, 24),
            ['--bar-progress' as string]: `${progress}%`
          }}
        >
          <span className="gantt-bar-fill" />
          <span className="gantt-bar-label">{row.name}</span>
          <span className="gantt-bar-progress">{progress}%</span>
        </div>
      </div>
    </Tooltip>
  );
}

function defaultScheduleDates(planStartDate?: string): [Dayjs, Dayjs] {
  const start = planStartDate ? dayjs(planStartDate) : dayjs().startOf('month');
  return [start, start.add(2, 'day')];
}
