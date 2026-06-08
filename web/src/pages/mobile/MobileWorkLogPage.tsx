import { Button, Card, DatePicker, Form, Input, InputNumber, Select, Typography, message } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { createWorkLog, fetchLookups, fetchMyTasks, fetchWorkLogPlanItems } from '../../services/cases';

export function MobileWorkLogPage() {
  const [form] = Form.useForm();
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: fetchLookups });
  const tasks = useQuery({ queryKey: ['my-tasks'], queryFn: fetchMyTasks });
  const planItems = useQuery({
    queryKey: ['work-log-plan-items', selectedDate],
    queryFn: () => fetchWorkLogPlanItems({ work_date: selectedDate })
  });
  const mutation = useMutation({
    mutationFn: createWorkLog,
    onSuccess: () => {
      message.success('日报已提交');
      form.resetFields(['production_plan_item_id', 'case_task_id', 'actual_employee_id', 'quantity', 'piece_count', 'weight', 'work_content']);
      form.setFieldsValue({ work_date: dayjs(selectedDate), hours: 8, unit: '件' });
    },
    onError: (error) => message.error(error.message)
  });

  return (
    <Card>
      <Typography.Title level={4}>录入日报</Typography.Title>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ work_date: dayjs(selectedDate), hours: 8, unit: '件' }}
        onFinish={(values) => {
          const planItem = (planItems.data ?? []).find((item) => item.id === values.production_plan_item_id);
          const task = (tasks.data ?? []).find((item) => item.id === (planItem?.case_task_id ?? values.case_task_id)) as Record<string, unknown> | undefined;
          const taskId = planItem?.case_task_id ?? values.case_task_id;
          if (!taskId) {
            message.error('请选择生产计划活动或任务');
            return;
          }
          mutation.mutate({
            ...values,
            production_plan_item_id: planItem?.id ?? null,
            project_case_id: planItem?.project_case_id ?? task?.project_case_id,
            case_item_id: planItem?.case_item_id ?? task?.case_item_id ?? null,
            case_task_id: taskId,
            team_id: planItem?.assigned_team_id ?? task?.team_id ?? null,
            work_date: values.work_date.format('YYYY-MM-DD')
          });
        }}
      >
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
        <Form.Item label="生产计划活动" name="production_plan_item_id">
          <Select
            showSearch
            allowClear
            loading={planItems.isLoading}
            optionFilterProp="label"
            placeholder="当天无计划时可跳过"
            options={(planItems.data ?? []).map((item) => ({
              value: item.id,
              label: `${item.name} / ${item.project_case_name ?? '-'} / ${item.case_item_name ?? '-'}`
            }))}
            onChange={(value) => {
              const item = (planItems.data ?? []).find((row) => row.id === value);
              if (item) form.setFieldsValue({ case_task_id: item.case_task_id, work_content: form.getFieldValue('work_content') || item.name });
            }}
          />
        </Form.Item>
        <Form.Item label="任务" name="case_task_id" rules={[{ required: true }]}>
          <Select
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder="搜索项目、子项目或阶段"
            options={(tasks.data ?? []).map((item) => ({ value: String(item.id), label: `${item.case_name ?? ''} / ${item.item_name ?? '-'} / ${item.name ?? ''}` }))}
          />
        </Form.Item>
        <Form.Item label="实际工作员工" name="actual_employee_id" rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="搜索员工"
            options={(lookups.data?.employees ?? []).map((item) => ({ value: item.id, label: item.name }))}
          />
        </Form.Item>
        <Form.Item label="工时(h)" name="hours" rules={[{ required: true }]}>
          <InputNumber min={0.5} max={24} step={0.5} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="完成数量" name="quantity">
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
        <Form.Item label="工作内容" name="work_content" rules={[{ required: true }]}>
          <Input.TextArea rows={4} />
        </Form.Item>
        <Button block type="primary" htmlType="submit" loading={mutation.isPending}>提交日报</Button>
      </Form>
    </Card>
  );
}
