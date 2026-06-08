import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Segmented, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';
import { createWorkLog, fetchLookups, fetchMyTasks, fetchWorkLogPlanItems, fetchWorkLogs } from '../../services/cases';
import type { WorkLogEntry, WorkLogPlanItem, WorkbenchTask } from '../../types';

type WorkLogMode = 'scheduled' | 'manual';

type WorkLogFormValues = {
  production_plan_item_id?: string;
  case_task_id?: string;
  actual_employee_id: string;
  work_date: Dayjs;
  hours: number;
  quantity?: number | null;
  piece_count?: number | null;
  weight?: number | null;
  unit?: string;
  work_content: string;
  output_note?: string;
};

export function WorkLogsPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<WorkLogFormValues>();
  const [mode, setMode] = useState<WorkLogMode>('scheduled');
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: fetchLookups });
  const tasks = useQuery({ queryKey: ['my-tasks'], queryFn: fetchMyTasks });
  const planItems = useQuery({
    queryKey: ['work-log-plan-items', selectedDate],
    queryFn: () => fetchWorkLogPlanItems({ work_date: selectedDate }),
    enabled: mode === 'scheduled'
  });
  const workLogs = useQuery({ queryKey: ['work-logs'], queryFn: fetchWorkLogs });

  const mutation = useMutation({
    mutationFn: createWorkLog,
    onSuccess: async () => {
      message.success('日报已录入');
      form.resetFields(['production_plan_item_id', 'case_task_id', 'actual_employee_id', 'quantity', 'piece_count', 'weight', 'work_content', 'output_note']);
      form.setFieldsValue({ work_date: dayjs(selectedDate), hours: 8, unit: '件' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['work-logs'] }),
        queryClient.invalidateQueries({ queryKey: ['work-log-plan-items'] }),
        queryClient.invalidateQueries({ queryKey: ['production-plan-board'] })
      ]);
    },
    onError: (error) => message.error(error.message)
  });

  const planOptions = useMemo(() => (planItems.data ?? []).map((item) => ({
    value: item.id,
    label: formatPlanOption(item)
  })), [planItems.data]);
  const taskOptions = useMemo(() => (tasks.data ?? []).map((item) => ({
    value: String(item.id),
    label: formatTaskOption(item)
  })), [tasks.data]);

  const selectPlanItem = (item: WorkLogPlanItem) => {
    form.setFieldsValue({
      production_plan_item_id: item.id,
      case_task_id: item.case_task_id ?? undefined,
      work_content: form.getFieldValue('work_content') || item.name
    });
  };

  const submitWorkLog = (values: WorkLogFormValues) => {
    const selectedPlanItem = mode === 'scheduled'
      ? (planItems.data ?? []).find((item) => item.id === values.production_plan_item_id)
      : null;
    const selectedTask = (tasks.data ?? []).find((item) => item.id === (selectedPlanItem?.case_task_id ?? values.case_task_id));
    const taskId = selectedPlanItem?.case_task_id ?? selectedTask?.id;

    if (!taskId) {
      message.error(mode === 'scheduled' ? '请选择生产计划活动' : '请选择任务');
      return;
    }

    mutation.mutate({
      production_plan_item_id: selectedPlanItem?.id ?? null,
      project_case_id: selectedPlanItem?.project_case_id ?? selectedTask?.project_case_id,
      case_item_id: selectedPlanItem?.case_item_id ?? selectedTask?.case_item_id ?? null,
      case_task_id: taskId,
      team_id: selectedPlanItem?.assigned_team_id ?? selectedTask?.team_id ?? null,
      actual_employee_id: values.actual_employee_id,
      work_date: values.work_date.format('YYYY-MM-DD'),
      hours: values.hours,
      quantity: values.quantity ?? null,
      piece_count: values.piece_count ?? null,
      weight: values.weight ?? null,
      unit: values.unit ?? '',
      work_content: values.work_content,
      output_note: values.output_note ?? ''
    });
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card>
        <Typography.Title level={4} style={{ margin: 0 }}>
          日报与工时
        </Typography.Title>
        <Typography.Text type="secondary">
          按生产计划报工会自动沉淀到排期甘特；临时工作可以作为未排期日报保留。
        </Typography.Text>
      </Card>

      <Card title="班组长录入日报">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Segmented
            value={mode}
            options={[
              { label: '按生产计划报工', value: 'scheduled' },
              { label: '未排期报工', value: 'manual' }
            ]}
            onChange={(value) => {
              setMode(value as WorkLogMode);
              form.resetFields(['production_plan_item_id', 'case_task_id', 'work_content']);
            }}
          />
          {mode === 'scheduled' && !planItems.isLoading && (planItems.data ?? []).length === 0 ? (
            <Alert type="info" showIcon message="当天没有可报工的生产计划活动，可以切换到未排期报工。" />
          ) : null}
          <Form
            form={form}
            layout="vertical"
            onFinish={submitWorkLog}
            initialValues={{ work_date: dayjs(selectedDate), hours: 8, unit: '件' }}
          >
            <div className="form-grid work-log-form-grid">
              <Form.Item label="日期" name="work_date" rules={[{ required: true }]}>
                <DatePicker
                  style={{ width: '100%' }}
                  onChange={(value) => {
                    const nextDate = value?.format('YYYY-MM-DD') ?? dayjs().format('YYYY-MM-DD');
                    setSelectedDate(nextDate);
                    form.resetFields(['production_plan_item_id']);
                  }}
                />
              </Form.Item>
              {mode === 'scheduled' ? (
                <Form.Item label="生产计划活动" name="production_plan_item_id" rules={[{ required: true, message: '请选择生产计划活动' }]}>
                  <Select
                    showSearch
                    allowClear
                    loading={planItems.isLoading}
                    optionFilterProp="label"
                    placeholder="搜索计划活动 / 项目 / 子项目"
                    options={planOptions}
                    onChange={(value) => {
                      const item = (planItems.data ?? []).find((row) => row.id === value);
                      if (item) selectPlanItem(item);
                    }}
                  />
                </Form.Item>
              ) : (
                <Form.Item label="任务" name="case_task_id" rules={[{ required: true, message: '请选择任务' }]}>
                  <Select
                    showSearch
                    allowClear
                    optionFilterProp="label"
                    placeholder="搜索项目、子项目或阶段"
                    options={taskOptions}
                  />
                </Form.Item>
              )}
              <Form.Item label="实际工作员工" name="actual_employee_id" rules={[{ required: true, message: '请选择员工' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="搜索员工"
                  options={(lookups.data?.employees ?? []).map((item) => ({ value: item.id, label: item.name }))}
                />
              </Form.Item>
              <Form.Item label="工时(h)" name="hours" rules={[{ required: true, message: '请输入工时' }]}>
                <InputNumber min={0.5} max={24} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="数量" name="quantity">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="件数" name="piece_count">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="重量(T)" name="weight">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="单位" name="unit">
                <Select options={['件', '套', 'T', '米'].map((value) => ({ value, label: value }))} />
              </Form.Item>
            </div>
            <Form.Item label="工作内容" name="work_content" rules={[{ required: true, message: '请输入工作内容' }]}>
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item label="产出说明" name="output_note">
              <Input />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={mutation.isPending}>
              提交日报
            </Button>
          </Form>
        </Space>
      </Card>

      {mode === 'scheduled' ? (
        <Card title={`当天计划活动 ${planItems.data?.length ?? 0}`}>
          <Table<WorkLogPlanItem>
            rowKey="id"
            size="small"
            loading={planItems.isLoading}
            dataSource={planItems.data ?? []}
            pagination={{ pageSize: 6, showSizeChanger: false }}
            columns={buildPlanItemColumns(selectPlanItem)}
          />
        </Card>
      ) : (
        <Card title="未排期可选任务">
          <Table<WorkbenchTask>
            rowKey={(row) => String(row.id)}
            size="small"
            dataSource={tasks.data ?? []}
            columns={[
              { title: '项目', dataIndex: 'case_name' },
              { title: '子项目', dataIndex: 'item_name' },
              { title: '任务', dataIndex: 'name', width: 120 },
              { title: '班组', dataIndex: 'team_name', width: 100, render: (value) => value || '-' },
              { title: '进度', dataIndex: 'progress', width: 90, render: (value) => `${Math.round(Number(value))}%` }
            ]}
          />
        </Card>
      )}

      <Card title="最近日报">
        <Table<WorkLogEntry>
          rowKey="id"
          size="small"
          loading={workLogs.isLoading}
          dataSource={workLogs.data ?? []}
          columns={buildWorkLogColumns()}
          scroll={{ x: 980 }}
        />
      </Card>
    </Space>
  );
}

function buildPlanItemColumns(onUse: (item: WorkLogPlanItem) => void): ColumnsType<WorkLogPlanItem> {
  return [
    {
      title: '计划活动',
      dataIndex: 'name',
      width: 260,
      render: (value: string, row) => (
        <Tooltip title={<PlanItemTooltip row={row} />}>
          <Space direction="vertical" size={0} className="work-log-plan-title">
            <Typography.Text strong className="matrix-ellipsis-text">{value}</Typography.Text>
            <Typography.Text type="secondary" className="production-plan-meta">
              {row.planned_start_date} 至 {row.planned_end_date}
            </Typography.Text>
          </Space>
        </Tooltip>
      )
    },
    {
      title: '关联项目',
      key: 'project',
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text className="matrix-ellipsis-text">{row.project_case_name ?? '-'}</Typography.Text>
          <Typography.Text type="secondary" className="production-plan-meta">
            {[row.case_item_name, row.task_name].filter(Boolean).join(' / ') || '-'}
          </Typography.Text>
        </Space>
      )
    },
    { title: '部门', dataIndex: 'department_name', width: 100, render: (value) => value || '-' },
    { title: '班组', dataIndex: 'assigned_team_name', width: 90, render: (value) => value || '-' },
    {
      title: '已报工',
      key: 'actual',
      width: 120,
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{formatHours(row.actual_hours)}</Typography.Text>
          <Typography.Text type="secondary" className="production-plan-meta">
            {row.work_log_count} 条 / {row.actual_employee_count} 人
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 84,
      align: 'center',
      render: (_value, row) => (
        <Button size="small" type="primary" onClick={() => onUse(row)}>
          选择
        </Button>
      )
    }
  ];
}

function buildWorkLogColumns(): ColumnsType<WorkLogEntry> {
  return [
    { title: '日期', dataIndex: 'work_date', width: 110 },
    {
      title: '计划关联',
      key: 'schedule',
      width: 180,
      render: (_value, row) => (
        <Space size={4}>
          <ScheduleStatusTag status={row.schedule_link_status} />
          <Tooltip title={row.production_plan_item_name ?? '未关联生产计划'}>
            <Typography.Text className="matrix-ellipsis-text work-log-schedule-name">
              {row.production_plan_item_name ?? '未排期'}
            </Typography.Text>
          </Tooltip>
        </Space>
      )
    },
    { title: '项目', dataIndex: 'case_name', width: 180 },
    { title: '子项目', dataIndex: 'item_name', width: 180 },
    { title: '任务', dataIndex: 'task_name', width: 100 },
    { title: '员工', dataIndex: 'actual_employee_name', width: 100 },
    { title: '班组', dataIndex: 'team_name', width: 90, render: (value) => value || '-' },
    { title: '工时', dataIndex: 'hours', width: 80, render: (value) => formatHours(value) },
    { title: '数量', dataIndex: 'quantity', width: 90, render: (value, row) => (value ? `${value}${row.unit ?? ''}` : '-') },
    { title: '件数', dataIndex: 'piece_count', width: 80, render: (value) => value ?? '-' },
    { title: '重量', dataIndex: 'weight', width: 80, render: (value) => value ? `${value}T` : '-' },
    { title: '工作内容', dataIndex: 'work_content', width: 240 }
  ];
}

function PlanItemTooltip({ row }: { row: WorkLogPlanItem }) {
  return (
    <div className="schedule-detail-tooltip">
      <div className="schedule-detail-title">{row.name}</div>
      <div><span>项目：</span>{row.project_case_name ?? '-'}</div>
      <div><span>子项目：</span>{row.case_item_name ?? '-'}</div>
      <div><span>阶段：</span>{row.task_name ?? '-'}</div>
      <div><span>排期：</span>{row.planned_start_date} 至 {row.planned_end_date}</div>
      <div><span>班组：</span>{row.assigned_team_name ?? '-'}</div>
      <div><span>已报工：</span>{formatHours(row.actual_hours)} / {row.work_log_count} 条</div>
    </div>
  );
}

function ScheduleStatusTag({ status }: { status?: WorkLogEntry['schedule_link_status'] }) {
  if (status === 'scheduled') return <Tag color="green">计划内</Tag>;
  if (status === 'outside_plan') return <Tag color="orange">超计划</Tag>;
  return <Tag color="default">未排期</Tag>;
}

function formatPlanOption(item: WorkLogPlanItem) {
  return `${item.name} / ${item.project_case_name ?? '-'} / ${item.case_item_name ?? '-'} / ${item.task_name ?? '-'} / ${item.assigned_team_name ?? '-'}`;
}

function formatTaskOption(item: WorkbenchTask) {
  return `${item.case_name ?? ''} / ${item.item_name ?? '-'} / ${item.name ?? ''}`;
}

function formatHours(value: unknown) {
  const hours = Number(value ?? 0);
  if (!Number.isFinite(hours)) return '-';
  return `${Math.round(hours * 10) / 10}h`;
}
