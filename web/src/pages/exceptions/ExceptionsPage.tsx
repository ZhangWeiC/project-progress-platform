import { Button, Card, Form, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createException, fetchExceptions, fetchLookups, fetchMyTasks, patchException } from '../../services/cases';
import { statusColor, statusLabel } from '../../utils/labels';

export function ExceptionsPage() {
  const queryClient = useQueryClient();
  const exceptions = useQuery({ queryKey: ['exceptions'], queryFn: fetchExceptions });
  const tasks = useQuery({ queryKey: ['my-tasks'], queryFn: fetchMyTasks });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: fetchLookups });

  const createMutation = useMutation({
    mutationFn: createException,
    onSuccess: async () => {
      message.success('异常已创建');
      await queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (error) => message.error(error.message)
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) => patchException(id, { status: 'resolved', resolution: '已处理' }),
    onSuccess: async () => {
      message.success('异常已标记解决');
      await queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    }
  });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card>
        <Typography.Title level={4} style={{ margin: 0 }}>
          异常情况
        </Typography.Title>
      </Card>
      <Card title="新建异常">
        <Form
          layout="vertical"
          onFinish={(values) => {
            const task = (tasks.data ?? []).find((item) => item.id === values.case_task_id) as Record<string, unknown> | undefined;
            createMutation.mutate({
              ...values,
              project_case_id: task?.project_case_id,
              case_item_id: task?.case_item_id ?? null
            });
          }}
          initialValues={{ type: 'other', level: 'medium' }}
        >
          <div className="form-grid">
            <Form.Item label="关联任务" name="case_task_id" rules={[{ required: true }]}>
              <Select
                showSearch
                allowClear
                optionFilterProp="label"
                placeholder="搜索项目、子项目或阶段"
                options={(tasks.data ?? []).map((item) => ({
                  value: String(item.id),
                  label: `${item.case_name ?? ''} / ${item.item_name ?? '-'} / ${item.name ?? ''}`
                }))}
              />
            </Form.Item>
            <Form.Item label="责任部门" name="responsible_department_id">
              <Select
                showSearch
                allowClear
                optionFilterProp="label"
                placeholder="搜索责任部门"
                options={(lookups.data?.departments ?? []).map((item) => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
            <Form.Item label="当前处理人" name="current_handler_id">
              <Select
                showSearch
                allowClear
                optionFilterProp="label"
                placeholder="搜索处理人"
                options={(lookups.data?.employees ?? []).map((item) => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
            <Form.Item label="等级" name="level">
              <Select options={[{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]} />
            </Form.Item>
          </div>
          <Form.Item label="标题" name="title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="描述" name="description" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
            创建异常
          </Button>
        </Form>
      </Card>
      <Card title="异常列表">
        <Table
          rowKey="id"
          size="small"
          dataSource={exceptions.data ?? []}
          columns={[
            { title: '状态', dataIndex: 'status', width: 100, render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
            { title: '标题', dataIndex: 'title' },
            { title: '项目', dataIndex: 'case_name' },
            { title: '任务', dataIndex: 'task_name' },
            { title: '责任部门', dataIndex: 'responsible_department_name' },
            { title: '处理人', dataIndex: 'current_handler_name' },
            {
              title: '操作',
              width: 120,
              render: (_value, row) => (
                <Button size="small" disabled={row.status === 'resolved'} onClick={() => closeMutation.mutate(row.id)}>
                  标记解决
                </Button>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}
