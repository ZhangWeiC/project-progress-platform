import { Button, Card, Col, Progress, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchCases, fetchExceptions, fetchWorkbench, fetchWorkLogs } from '../../services/cases';
import type { ExceptionRecord, ProjectCase, WorkbenchTask, WorkLogEntry } from '../../types';
import { statusColor, statusLabel } from '../../utils/labels';

export function DashboardPage() {
  const navigate = useNavigate();
  const casesQuery = useQuery({ queryKey: ['cases'], queryFn: fetchCases });
  const workbenchQuery = useQuery({ queryKey: ['workbench'], queryFn: fetchWorkbench });
  const exceptionsQuery = useQuery({ queryKey: ['exceptions'], queryFn: fetchExceptions });
  const workLogsQuery = useQuery({ queryKey: ['work-logs'], queryFn: fetchWorkLogs });

  const cases = casesQuery.data ?? [];
  const exceptions = (exceptionsQuery.data ?? []).filter((item) => !['resolved', 'closed', 'cancelled'].includes(item.status));
  const workLogs = workLogsQuery.data ?? [];
  const activeCases = cases.filter((item) => item.status !== 'completed').length;
  const totalHours = workLogs.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div className="page-title-row">
        <Typography.Title level={4} style={{ margin: 0 }}>
          业务工作台
        </Typography.Title>
        <Space>
          <Button onClick={() => navigate('/imports')}>导入 Excel</Button>
          <Button type="primary" onClick={() => navigate('/cases')}>查看进度总表</Button>
        </Space>
      </div>

      <Row gutter={12}>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="进行中项目" value={activeCases} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="未关闭异常" value={exceptions.length} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="我的任务" value={workbenchQuery.data?.counts.tasks ?? 0} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="累计工时" value={totalHours} suffix="小时" /></Card></Col>
      </Row>

      <Card title="项目进度">
        <Table<ProjectCase>
          rowKey="id"
          size="small"
          loading={casesQuery.isLoading}
          dataSource={cases}
          pagination={false}
          columns={[
            { title: '项目', dataIndex: 'name' },
            { title: '业务部负责人', dataIndex: 'business_owner_name', width: 130 },
            { title: '设计部负责人', dataIndex: 'design_owner_name', width: 130 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>
            },
            {
              title: '总进度',
              dataIndex: 'total_progress',
              width: 180,
              render: (value) => <Progress percent={Math.round(Number(value ?? 0))} size="small" />
            },
            {
              title: '异常',
              dataIndex: 'open_exception_count',
              width: 90,
              render: (value) => Number(value ?? 0) > 0 ? <Tag color="red">{value}</Tag> : '-'
            },
            {
              title: '操作',
              width: 110,
              render: (_value, row) => <Button size="small" onClick={() => navigate(`/cases?caseId=${row.id}`)}>进度总表</Button>
            }
          ]}
        />
      </Card>

      <Row gutter={12}>
        <Col xs={24} xl={12}>
          <Card title="现场任务">
            <Table<WorkbenchTask>
              rowKey="id"
              size="small"
              loading={workbenchQuery.isLoading}
              dataSource={workbenchQuery.data?.tasks ?? []}
              pagination={false}
              columns={[
                { title: '项目', dataIndex: 'case_name' },
                { title: '子项目', dataIndex: 'item_name', width: 120 },
                { title: '任务', dataIndex: 'name', width: 120 },
                {
                  title: '进度',
                  dataIndex: 'progress',
                  width: 120,
                  render: (value) => <Progress percent={Math.round(Number(value ?? 0))} size="small" />
                }
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="待处理异常">
            <Table<ExceptionRecord>
              rowKey="id"
              size="small"
              loading={exceptionsQuery.isLoading}
              dataSource={exceptions.slice(0, 5)}
              pagination={false}
              columns={[
                { title: '标题', dataIndex: 'title' },
                { title: '项目', dataIndex: 'case_name' },
                { title: '责任部门', dataIndex: 'responsible_department_name', width: 120 },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 90,
                  render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>
                }
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近日报">
        <Table<WorkLogEntry>
          rowKey="id"
          size="small"
          loading={workLogsQuery.isLoading}
          dataSource={workLogs.slice(0, 5)}
          pagination={false}
          columns={[
            { title: '日期', dataIndex: 'work_date', width: 110 },
            { title: '项目', dataIndex: 'case_name' },
            { title: '子项目', dataIndex: 'item_name', width: 120 },
            { title: '工序', dataIndex: 'subtask_name', width: 130 },
            { title: '员工', dataIndex: 'actual_employee_name', width: 110 },
            { title: '工时', dataIndex: 'hours', width: 90, render: (value) => `${value}h` },
            { title: '工作内容', dataIndex: 'work_content' }
          ]}
        />
      </Card>
    </Space>
  );
}
