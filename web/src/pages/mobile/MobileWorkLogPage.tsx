import { Button, Card, DatePicker, Form, Input, InputNumber, Select, Typography, message } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { createWorkLog, fetchLookups, fetchMyTasks } from '../../services/cases';

export function MobileWorkLogPage() {
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: fetchLookups });
  const tasks = useQuery({ queryKey: ['my-tasks'], queryFn: fetchMyTasks });
  const mutation = useMutation({
    mutationFn: createWorkLog,
    onSuccess: () => message.success('日报已提交'),
    onError: (error) => message.error(error.message)
  });

  return (
    <Card>
      <Typography.Title level={4}>录入日报</Typography.Title>
      <Form
        layout="vertical"
        initialValues={{ work_date: dayjs(), hours: 8, unit: '件' }}
        onFinish={(values) => {
          const task = (tasks.data ?? []).find((item) => item.id === values.case_task_id) as Record<string, unknown> | undefined;
          mutation.mutate({
            ...values,
            project_case_id: task?.project_case_id,
            case_item_id: task?.case_item_id ?? null,
            work_date: values.work_date.format('YYYY-MM-DD')
          });
        }}
      >
        <Form.Item label="任务" name="case_task_id" rules={[{ required: true }]}>
          <Select options={(tasks.data ?? []).map((item) => ({ value: String(item.id), label: `${item.case_name ?? ''} / ${item.item_name ?? '-'} / ${item.name ?? ''}` }))} />
        </Form.Item>
        <Form.Item label="实际工作员工" name="actual_employee_id" rules={[{ required: true }]}>
          <Select options={(lookups.data?.employees ?? []).map((item) => ({ value: item.id, label: item.name }))} />
        </Form.Item>
        <Form.Item label="日期" name="work_date" rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="工时" name="hours" rules={[{ required: true }]}>
          <InputNumber min={0.5} max={24} step={0.5} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="完成数量" name="quantity">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="单位" name="unit">
          <Select options={['件', '套', 'T', '米'].map((value) => ({ value, label: value }))} />
        </Form.Item>
        <Form.Item label="工作内容" name="work_content" rules={[{ required: true }]}>
          <Input.TextArea rows={4} />
        </Form.Item>
        <Button block type="primary" htmlType="submit" loading={mutation.isPending}>提交日报</Button>
      </Form>
    </Card>
  );
}
