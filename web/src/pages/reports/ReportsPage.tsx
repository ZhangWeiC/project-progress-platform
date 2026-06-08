import { CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Col, DatePicker, Progress, Row, Segmented, Select, Space, Statistic, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { fetchWorkSummaryReport } from '../../services/reports';
import type { ExceptionRecord, ProductionPlanEmployeeActual, ProductionPlanItem, WorkLogEntry, WorkSummaryReport } from '../../types';

type ReportPeriod = 'week' | 'month';

export function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>('month');
  const [filters, setFilters] = useState<{
    start_date?: string;
    end_date?: string;
    department_id?: string;
    team_id?: string;
    project_case_id?: string;
  }>({});

  const reportQuery = useQuery({
    queryKey: ['work-summary-report', period, filters],
    queryFn: () => fetchWorkSummaryReport({ period, ...filters })
  });
  const report = reportQuery.data;
  const summary = report?.summary;
  const dateRangeValue = filters.start_date && filters.end_date
    ? [dayjs(filters.start_date), dayjs(filters.end_date)] as [Dayjs, Dayjs]
    : undefined;

  const copyReport = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(report.report_text.join('\n'));
    message.success('报告摘要已复制');
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="page-toolbar">
        <div className="page-title-row">
          <Space direction="vertical" size={0}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              统计报表
            </Typography.Title>
            <Typography.Text type="secondary">
              {report ? `${report.period === 'week' ? '周报' : '月报'} / ${report.range.start_date} 至 ${report.range.end_date}` : '按日报工时和生产计划生成周报、月报'}
            </Typography.Text>
          </Space>
          <Space wrap>
            <Segmented
              value={period}
              options={[
                { label: '周报', value: 'week' },
                { label: '月报', value: 'month' }
              ]}
              onChange={(value) => {
                setPeriod(value as ReportPeriod);
                setFilters((current) => ({ ...current, start_date: undefined, end_date: undefined }));
              }}
            />
            <DatePicker.RangePicker
              allowClear
              value={dateRangeValue}
              placeholder={['开始日期', '结束日期']}
              style={{ width: 240 }}
              onChange={(dates) => setFilters((current) => ({
                ...current,
                start_date: dates?.[0]?.format('YYYY-MM-DD'),
                end_date: dates?.[1]?.format('YYYY-MM-DD')
              }))}
            />
            <Select
              allowClear
              showSearch
              placeholder="部门"
              value={filters.department_id}
              options={(report?.filters.departments ?? []).map((item) => ({ value: item.id, label: item.name }))}
              optionFilterProp="label"
              style={{ width: 140 }}
              onChange={(value) => setFilters((current) => ({ ...current, department_id: value }))}
            />
            <Select
              allowClear
              showSearch
              placeholder="班组"
              value={filters.team_id}
              options={(report?.filters.teams ?? []).map((item) => ({ value: item.id, label: item.name }))}
              optionFilterProp="label"
              style={{ width: 130 }}
              onChange={(value) => setFilters((current) => ({ ...current, team_id: value }))}
            />
            <Select
              allowClear
              showSearch
              placeholder="项目"
              value={filters.project_case_id}
              options={(report?.filters.projects ?? []).map((item) => ({ value: item.id, label: item.name }))}
              optionFilterProp="label"
              style={{ width: 260 }}
              onChange={(value) => setFilters((current) => ({ ...current, project_case_id: value }))}
            />
            <Button icon={<ReloadOutlined />} onClick={() => reportQuery.refetch()}>
              刷新
            </Button>
            <Button icon={<CopyOutlined />} onClick={copyReport} disabled={!report}>
              复制摘要
            </Button>
          </Space>
        </div>
      </Card>

      <Row gutter={12}>
        <Col xs={12} lg={4}><Card size="small"><Statistic title="实际工时" value={summary?.actual_hours ?? 0} suffix="h" loading={reportQuery.isLoading} /></Card></Col>
        <Col xs={12} lg={4}><Card size="small"><Statistic title="日报数" value={summary?.work_log_count ?? 0} loading={reportQuery.isLoading} /></Card></Col>
        <Col xs={12} lg={4}><Card size="small"><Statistic title="参与员工" value={summary?.employee_count ?? 0} loading={reportQuery.isLoading} /></Card></Col>
        <Col xs={12} lg={4}><Card size="small"><Statistic title="计划项" value={summary?.planned_item_count ?? 0} loading={reportQuery.isLoading} /></Card></Col>
        <Col xs={12} lg={4}><Card size="small"><Statistic title="排了没报" value={summary?.not_reported_count ?? 0} loading={reportQuery.isLoading} /></Card></Col>
        <Col xs={12} lg={4}><Card size="small"><Statistic title="未关闭异常" value={summary?.open_exception_count ?? 0} loading={reportQuery.isLoading} /></Card></Col>
      </Row>

      <Card
        title="报告摘要"
        extra={
          <Space size={4} wrap>
            <Tag color={summary?.unscheduled_count ? 'blue' : 'default'}>未排期 {summary?.unscheduled_count ?? 0}</Tag>
            <Tag color={summary?.outside_plan_count ? 'red' : 'default'}>超计划 {summary?.outside_plan_count ?? 0}</Tag>
            <Tag color={summary?.delayed_plan_count ? 'orange' : 'default'}>延期 {summary?.delayed_plan_count ?? 0}</Tag>
          </Space>
        }
      >
        <div className="report-summary-text">
          {(report?.report_text ?? []).map((line) => (
            <Typography.Paragraph key={line} style={{ marginBottom: 6 }}>
              {line}
            </Typography.Paragraph>
          ))}
        </div>
      </Card>

      <Card className="report-table-card" title="明细分析">
        <Tabs
          size="small"
          items={[
            {
              key: 'project',
              label: '项目汇总',
              children: (
                <Table<WorkSummaryReport['project_summaries'][number]>
                  rowKey="project_case_id"
                  size="small"
                  loading={reportQuery.isLoading}
                  dataSource={report?.project_summaries ?? []}
                  columns={buildProjectColumns()}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                />
              )
            },
            {
              key: 'department',
              label: '部门汇总',
              children: (
                <Table<WorkSummaryReport['department_summaries'][number]>
                  rowKey={(row) => String(row.department_id ?? row.department_name)}
                  size="small"
                  loading={reportQuery.isLoading}
                  dataSource={report?.department_summaries ?? []}
                  columns={buildDepartmentColumns()}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                />
              )
            },
            {
              key: 'team',
              label: '班组汇总',
              children: (
                <Table<WorkSummaryReport['team_summaries'][number]>
                  rowKey={(row) => String(row.team_id ?? row.team_name)}
                  size="small"
                  loading={reportQuery.isLoading}
                  dataSource={report?.team_summaries ?? []}
                  columns={buildTeamColumns()}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                />
              )
            },
            {
              key: 'employee',
              label: '员工汇总',
              children: (
                <Table<ProductionPlanEmployeeActual>
                  rowKey="actual_employee_id"
                  size="small"
                  loading={reportQuery.isLoading}
                  dataSource={report?.employee_summaries ?? []}
                  columns={buildEmployeeColumns()}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                />
              )
            },
            {
              key: 'no-work',
              label: '排了没报',
              children: (
                <Table<ProductionPlanItem>
                  rowKey="id"
                  size="small"
                  loading={reportQuery.isLoading}
                  dataSource={report?.no_work_plan_items ?? []}
                  columns={buildNoWorkColumns()}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                />
              )
            },
            {
              key: 'anomaly',
              label: '偏差日报',
              children: (
                <Table<WorkLogEntry>
                  rowKey="id"
                  size="small"
                  loading={reportQuery.isLoading}
                  dataSource={report?.anomaly_work_logs ?? []}
                  columns={buildAnomalyWorkLogColumns()}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                  scroll={{ x: 960 }}
                />
              )
            },
            {
              key: 'exceptions',
              label: '未关闭异常',
              children: (
                <Table<ExceptionRecord>
                  rowKey="id"
                  size="small"
                  loading={reportQuery.isLoading}
                  dataSource={report?.open_exceptions ?? []}
                  columns={buildExceptionColumns()}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                />
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}

function buildProjectColumns(): ColumnsType<WorkSummaryReport['project_summaries'][number]> {
  return [
    {
      title: '项目',
      dataIndex: 'project_case_name',
      render: (value: string) => (
        <Tooltip title={value}>
          <Typography.Text strong className="matrix-ellipsis-text">{value}</Typography.Text>
        </Tooltip>
      )
    },
    { title: '进度', dataIndex: 'total_progress', width: 120, render: (value) => <Progress percent={Math.round(Number(value ?? 0))} size="small" /> },
    { title: '计划项', dataIndex: 'planned_item_count', width: 90 },
    { title: '完成项', dataIndex: 'completed_item_count', width: 90 },
    { title: '实际工时', dataIndex: 'actual_hours', width: 100, render: (value) => formatHours(value) },
    { title: '日报数', dataIndex: 'work_log_count', width: 90 },
    { title: '未排期', dataIndex: 'unscheduled_hours', width: 90, render: (value) => formatHours(value) },
    { title: '超计划', dataIndex: 'outside_plan_hours', width: 90, render: (value) => formatHours(value) },
    { title: '异常', dataIndex: 'open_exception_count', width: 80, render: (value) => value ? <Tag color="red">{value}</Tag> : 0 }
  ];
}

function buildDepartmentColumns(): ColumnsType<WorkSummaryReport['department_summaries'][number]> {
  return [
    { title: '部门', dataIndex: 'department_name', width: 140 },
    { title: '计划项', dataIndex: 'planned_item_count', width: 90 },
    { title: '完成项', dataIndex: 'completed_item_count', width: 90 },
    { title: '实际工时', dataIndex: 'actual_hours', width: 100, render: (value) => formatHours(value) },
    { title: '日报数', dataIndex: 'work_log_count', width: 90 },
    { title: '人数', dataIndex: 'employee_count', width: 80 },
    { title: '未排期工时', dataIndex: 'unscheduled_hours', width: 120, render: (value) => formatHours(value) },
    { title: '超计划工时', dataIndex: 'outside_plan_hours', width: 120, render: (value) => formatHours(value) }
  ];
}

function buildTeamColumns(): ColumnsType<WorkSummaryReport['team_summaries'][number]> {
  return [
    { title: '班组', dataIndex: 'team_name', width: 140 },
    { title: '计划项', dataIndex: 'planned_item_count', width: 90 },
    { title: '完成项', dataIndex: 'completed_item_count', width: 90 },
    { title: '实际工时', dataIndex: 'actual_hours', width: 100, render: (value) => formatHours(value) },
    { title: '日报数', dataIndex: 'work_log_count', width: 90 },
    { title: '人数', dataIndex: 'employee_count', width: 80 },
    { title: '未排期工时', dataIndex: 'unscheduled_hours', width: 120, render: (value) => formatHours(value) },
    { title: '超计划工时', dataIndex: 'outside_plan_hours', width: 120, render: (value) => formatHours(value) }
  ];
}

function buildEmployeeColumns(): ColumnsType<ProductionPlanEmployeeActual> {
  return [
    { title: '员工', dataIndex: 'actual_employee_name', width: 120, render: (value) => value || '-' },
    { title: '总工时', dataIndex: 'hours', width: 100, render: (value) => formatHours(value) },
    { title: '日报数', dataIndex: 'work_log_count', width: 90 },
    { title: '项目数', dataIndex: 'project_count', width: 90, render: (value) => value ?? '-' },
    { title: '数量', dataIndex: 'quantity', width: 90, render: (value) => value ?? '-' },
    { title: '件数', dataIndex: 'piece_count', width: 90, render: (value) => value ?? '-' },
    { title: '重量', dataIndex: 'weight', width: 90, render: (value) => value ? `${value}T` : '-' },
    { title: '工作日期', key: 'date', width: 180, render: (_value, row) => `${row.first_work_date ?? '-'} 至 ${row.last_work_date ?? '-'}` }
  ];
}

function buildNoWorkColumns(): ColumnsType<ProductionPlanItem> {
  return [
    {
      title: '排期活动',
      dataIndex: 'name',
      width: 240,
      render: (value: string) => (
        <Tooltip title={value}>
          <Typography.Text className="matrix-ellipsis-text">{value}</Typography.Text>
        </Tooltip>
      )
    },
    {
      title: '项目 / 阶段',
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
    { title: '计划时间', key: 'date', width: 170, render: (_value, row) => `${row.planned_start_date} 至 ${row.planned_end_date}` },
    { title: '状态', dataIndex: 'effective_status', width: 90, render: (value: string) => <Tag color={value === 'delayed' ? 'red' : 'blue'}>{value === 'delayed' ? '已延期' : value}</Tag> }
  ];
}

function buildAnomalyWorkLogColumns(): ColumnsType<WorkLogEntry> {
  return [
    { title: '日期', dataIndex: 'work_date', width: 110 },
    { title: '类型', dataIndex: 'schedule_link_status', width: 90, render: (value) => value === 'outside_plan' ? <Tag color="red">超计划</Tag> : <Tag color="blue">未排期</Tag> },
    {
      title: '项目 / 任务',
      key: 'project',
      width: 240,
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text className="matrix-ellipsis-text">{row.case_name ?? '-'}</Typography.Text>
          <Typography.Text type="secondary" className="production-plan-meta">
            {[row.item_name, row.task_name].filter(Boolean).join(' / ') || '-'}
          </Typography.Text>
        </Space>
      )
    },
    { title: '计划活动', dataIndex: 'production_plan_item_name', width: 180, render: (value) => value || '未排期' },
    { title: '员工', dataIndex: 'actual_employee_name', width: 90, render: (value) => value || '-' },
    { title: '班组', dataIndex: 'team_name', width: 90, render: (value) => value || '-' },
    { title: '工时', dataIndex: 'hours', width: 80, render: (value) => formatHours(value) },
    { title: '工作内容', dataIndex: 'work_content', width: 220 }
  ];
}

function buildExceptionColumns(): ColumnsType<ExceptionRecord> {
  return [
    { title: '异常', dataIndex: 'title', width: 220 },
    { title: '等级', dataIndex: 'level', width: 90, render: (value) => <Tag color={value === 'high' ? 'red' : 'orange'}>{value}</Tag> },
    { title: '项目', dataIndex: 'case_name' },
    { title: '阶段', dataIndex: 'task_name', width: 100, render: (value) => value || '-' },
    { title: '责任部门', dataIndex: 'responsible_department_name', width: 120, render: (value) => value || '-' },
    { title: '状态', dataIndex: 'status', width: 100 }
  ];
}

function formatHours(value: unknown) {
  const numberValue = Number(value ?? 0);
  if (!Number.isFinite(numberValue)) return '0h';
  return `${Math.round(numberValue * 10) / 10}h`;
}
