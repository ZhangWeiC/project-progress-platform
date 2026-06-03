import { Button, Card, DatePicker, Form, Input, InputNumber, Select, Space, Table, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { createWorkLog, fetchLookups, fetchMyTasks, fetchWorkLogs } from '../../services/cases';
import type { WorkLogEntry } from '../../types';

export function WorkLogsPage() {
  const queryClient = useQueryClient();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: fetchLookups });
  const tasks = useQuery({ queryKey: ['my-tasks'], queryFn: fetchMyTasks });
  const workLogs = useQuery({ queryKey: ['work-logs'], queryFn: fetchWorkLogs });
  const mutation = useMutation({
    mutationFn: createWorkLog,
    onSuccess: async () => {
      message.success('日报已录入');
      await queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['work-logs'] });
    },
    onError: (error) => message.error(error.message)
  });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card>
        <Typography.Title level={4} style={{ margin: 0 }}>
          日报与工时
        </Typography.Title>
      </Card>
      <Card title="班组长录入日报">
        <Form
          layout="vertical"
          onFinish={(values) => {
            const task = (tasks.data ?? []).find((item) => item.id === values.case_task_id) as Record<string, unknown> | undefined;
            mutation.mutate({
              ...values,
              project_case_id: task?.project_case_id,
              case_item_id: task?.case_item_id ?? null,
              work_date: values.work_date.format('YYYY-MM-DD')
            });
          }}
          initialValues={{ work_date: dayjs(), hours: 8, unit: '件' }}
        >
          <div className="form-grid">
            <Form.Item label="任务" name="case_task_id" rules={[{ required: true }]}>
              <Select
                showSearch
                options={(tasks.data ?? []).map((item) => ({
                  value: String(item.id),
                  label: `${item.case_name ?? ''} / ${item.item_name ?? '-'} / ${item.name ?? ''}`
                }))}
              />
            </Form.Item>
            <Form.Item label="实际工作员工" name="actual_employee_id" rules={[{ required: true }]}>
              <Select
                options={(lookups.data?.employees ?? []).map((item) => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
            <Form.Item label="日期" name="work_date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="工时" name="hours" rules={[{ required: true }]}>
              <InputNumber min={0.5} max={24} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="数量" name="quantity">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="单位" name="unit">
              <Select options={['件', '套', 'T', '米'].map((value) => ({ value, label: value }))} />
            </Form.Item>
          </div>
          <Form.Item label="工作内容" name="work_content" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="产出说明" name="output_note">
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            提交日报
          </Button>
        </Form>
      </Card>
      <Card title="我的任务">
        <Table
          rowKey={(row) => String(row.id)}
          size="small"
          dataSource={tasks.data ?? []}
          columns={[
            { title: '项目', dataIndex: 'case_name' },
            { title: '子项目', dataIndex: 'item_name' },
            { title: '任务', dataIndex: 'name' },
            { title: '进度', dataIndex: 'progress', render: (value) => `${Math.round(Number(value))}%` }
          ]}
        />
      </Card>
      <Card title="最近日报">
        <Table<WorkLogEntry>
          rowKey="id"
          size="small"
          loading={workLogs.isLoading}
          dataSource={workLogs.data ?? []}
          columns={[
            { title: '日期', dataIndex: 'work_date', width: 120 },
            { title: '项目', dataIndex: 'case_name' },
            { title: '子项目', dataIndex: 'item_name' },
            { title: '任务', dataIndex: 'task_name' },
            { title: '员工', dataIndex: 'actual_employee_name', width: 120 },
            { title: '工时', dataIndex: 'hours', width: 90, render: (value) => `${value}h` },
            { title: '数量', dataIndex: 'quantity', width: 100, render: (value, row) => (value ? `${value}${row.unit ?? ''}` : '-') },
            { title: '工作内容', dataIndex: 'work_content' }
          ]}
        />
      </Card>
    </Space>
  );
}
