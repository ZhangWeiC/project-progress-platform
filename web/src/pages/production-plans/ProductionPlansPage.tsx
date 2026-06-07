import { CalendarOutlined, LinkOutlined, SearchOutlined } from '@ant-design/icons';
import { Card, Col, Progress, Row, Select, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { fetchProductionPlanBoard } from '../../services/productionPlans';
import type { ProductionPlanBoardFilters } from '../../services/productionPlans';
import type { ProductionPlanItem } from '../../types';

const STATUS_LABELS: Record<string, string> = {
  planned: '计划中',
  in_progress: '进行中',
  completed: '已完成',
  delayed: '已延期',
  cancelled: '已取消'
};

const STATUS_COLORS: Record<string, string> = {
  planned: 'blue',
  in_progress: 'green',
  completed: 'default',
  delayed: 'red',
  cancelled: 'default'
};

export function ProductionPlansPage() {
  const [filters, setFilters] = useState<ProductionPlanBoardFilters>({});
  const boardQuery = useQuery({
    queryKey: ['production-plan-board', filters],
    queryFn: () => fetchProductionPlanBoard(filters)
  });

  const board = boardQuery.data;
  const columns = useMemo(() => buildColumns(board?.dates ?? []), [board?.dates]);
  const scrollX = 64 + 260 + 240 + (board?.dates.length ?? 0) * 38 + 330;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="page-toolbar">
        <div className="page-title-row">
          <Space direction="vertical" size={0}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              生产计划
            </Typography.Title>
            <Typography.Text type="secondary">
              {board?.plan ? `${board.plan.department_name} / ${board.plan.plan_month}` : '按部门和时间查看排产'}
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
          </Space>
        </div>
      </Card>

      <Row gutter={12}>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="计划任务" value={board?.summary.item_count ?? 0} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="关联项目" value={board?.summary.linked_project_count ?? 0} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="排产天数" value={board?.summary.scheduled_days ?? 0} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="已完成" value={board?.summary.completed_count ?? 0} /></Card></Col>
      </Row>

      <Card className="production-plan-card">
        <Table<ProductionPlanItem>
          rowKey="id"
          loading={boardQuery.isLoading}
          columns={columns}
          dataSource={board?.items ?? []}
          pagination={false}
          size="small"
          bordered
          sticky
          tableLayout="fixed"
          scroll={{ x: scrollX, y: 'calc(100vh - 270px)' }}
          rowClassName={(row) => `production-plan-row status-${row.effective_status}`}
        />
      </Card>
    </Space>
  );
}

function buildColumns(dates: string[]): ColumnsType<ProductionPlanItem> {
  const dateColumns: ColumnsType<ProductionPlanItem> = dates.map((date) => ({
    title: <DateHeader date={date} />,
    key: date,
    width: 38,
    align: 'center',
    className: 'production-plan-date-cell',
    onHeaderCell: () => ({ className: 'production-plan-date-header' }),
    render: (_value, row) => <GanttDateCell date={date} row={row} />
  }));

  return [
    {
      title: '序号',
      dataIndex: 'sort_order',
      key: 'sort_order',
      fixed: 'left',
      width: 64,
      align: 'center'
    },
    {
      title: '计划任务',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      width: 260,
      render: (value: string, row) => (
        <Space direction="vertical" size={0} className="production-plan-title-cell">
          <Tooltip title={value}>
            <Typography.Text strong className="matrix-ellipsis-text">{value}</Typography.Text>
          </Tooltip>
          <Typography.Text type="secondary" className="production-plan-meta">
            {row.planned_start_date} - {row.planned_end_date}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '关联项目 / 子项目',
      key: 'project',
      fixed: 'left',
      width: 240,
      render: (_value, row) => (
        <Space direction="vertical" size={0} className="production-plan-title-cell">
          <Typography.Text className="matrix-ellipsis-text">
            {row.project_case_name ? <LinkOutlined className="muted-icon" /> : null} {row.project_case_name ?? '-'}
          </Typography.Text>
          <Typography.Text type="secondary" className="matrix-ellipsis-text">
            {row.case_item_name ?? row.task_name ?? '-'}
          </Typography.Text>
        </Space>
      )
    },
    ...dateColumns,
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
      title: '施工班组',
      dataIndex: 'assigned_team_name',
      key: 'assigned_team_name',
      fixed: 'right',
      width: 96,
      render: (value: string | null) => value || '-'
    },
    {
      title: '完成度',
      dataIndex: 'progress',
      key: 'progress',
      fixed: 'right',
      width: 110,
      render: (value: number) => <Progress percent={Math.round(Number(value ?? 0))} size="small" />
    },
    {
      title: '状态',
      dataIndex: 'effective_status',
      key: 'effective_status',
      fixed: 'right',
      width: 84,
      render: (value: string) => <Tag color={STATUS_COLORS[value] ?? 'default'}>{STATUS_LABELS[value] ?? value}</Tag>
    }
  ];
}

function DateHeader({ date }: { date: string }) {
  const [, month, day] = date.split('-');
  return (
    <Space direction="vertical" size={0} className="production-plan-date-title">
      <span>{Number(day)}</span>
      <small>{Number(month)}月</small>
    </Space>
  );
}

function GanttDateCell({ date, row }: { date: string; row: ProductionPlanItem }) {
  const planned = date >= row.planned_start_date && date <= row.planned_end_date;
  const start = date === row.planned_start_date;
  const end = date === row.planned_end_date;
  const title = planned
    ? `${row.name}：${row.planned_start_date} 至 ${row.planned_end_date}`
    : `${date} 无排产`;
  return (
    <Tooltip title={title}>
      <div
        className={[
          'production-plan-day',
          planned ? 'is-planned' : '',
          start ? 'is-start' : '',
          end ? 'is-end' : ''
        ].filter(Boolean).join(' ')}
      >
        {planned && start ? <CalendarOutlined /> : null}
      </div>
    </Tooltip>
  );
}
