import { Alert, Descriptions, Drawer, Empty, InputNumber, List, Progress, Space, Table, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fetchTaskDetails, updateSubtaskProgress } from '../../services/cases';
import type { CaseSubTask } from '../../types';
import { statusColor, statusLabel } from '../../utils/labels';

type Props = {
  taskId?: string;
  open: boolean;
  onClose: () => void;
  matrixCaseId?: string;
};

export function TaskDrawer({ taskId, open, onClose, matrixCaseId }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => fetchTaskDetails(taskId!),
    enabled: Boolean(taskId && open)
  });

  const mutation = useMutation({
    mutationFn: ({ id, progress }: { id: string; progress: number }) => updateSubtaskProgress(id, progress),
    onSuccess: async () => {
      message.success('进度已更新');
      await queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      if (matrixCaseId) await queryClient.invalidateQueries({ queryKey: ['matrix', matrixCaseId] });
      await queryClient.invalidateQueries({ queryKey: ['matrix', 'all'] });
    },
    onError: (error) => message.error(error.message)
  });

  const subtaskColumns = [
    { title: '工序', dataIndex: 'name', width: 160 },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 120,
      render: (value: number) => <Progress percent={Math.round(value)} size="small" />
    },
    {
      title: '完成数量',
      dataIndex: 'completed_quantity',
      width: 110,
      render: (_: unknown, row: CaseSubTask) => {
        const quantity = row.completed_quantity ?? '-';
        const planned = row.planned_quantity ? ` / ${row.planned_quantity}${row.quantity_unit ?? ''}` : '';
        return `${quantity}${planned}`;
      }
    },
    {
      title: '更新',
      width: 120,
      render: (_: unknown, row: CaseSubTask) => {
        if (!row.editable) {
          return <Typography.Text type="secondary">只读</Typography.Text>;
        }
        return (
          <AutoSaveProgressInput
            row={row}
            saving={mutation.isPending && mutation.variables?.id === row.id}
            onSave={(id, progress) => mutation.mutate({ id, progress })}
          />
        );
      }
    }
  ];

  return (
    <Drawer title="任务详情" width={680} open={open} onClose={onClose} destroyOnClose>
      {isLoading && <Alert message="正在加载任务详情" type="info" />}
      {data && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="项目">{data.task.case_name}</Descriptions.Item>
            <Descriptions.Item label="子项目">{data.task.item_name ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="任务">{data.task.name}</Descriptions.Item>
            <Descriptions.Item label="进度">
              <Progress percent={Math.round(data.task.progress)} size="small" />
            </Descriptions.Item>
            <Descriptions.Item label="负责人">{data.task.assignee_name ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="班组">{data.task.team_name ?? '-'}</Descriptions.Item>
          </Descriptions>

          <div>
            <Typography.Title level={5}>工序</Typography.Title>
            <Table rowKey="id" size="small" pagination={false} columns={subtaskColumns} dataSource={data.subtasks} />
          </div>

          <div>
            <Typography.Title level={5}>异常情况</Typography.Title>
            {data.exceptions.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无异常" />
            ) : (
              <List
                size="small"
                dataSource={data.exceptions}
                renderItem={(item) => (
                  <List.Item>
                    <Space direction="vertical" size={2}>
                      <Space>
                        <Tag color={statusColor(item.status)}>{statusLabel(item.status)}</Tag>
                        <Typography.Text strong>{item.title}</Typography.Text>
                      </Space>
                      <Typography.Text type="secondary">
                        {item.responsible_department_name} · {item.current_handler_name}
                      </Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </div>

          <div>
            <Typography.Title level={5}>最近日报</Typography.Title>
            {data.workLogs.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无日报" />
            ) : (
              <List
                size="small"
                dataSource={data.workLogs}
                renderItem={(item) => (
                  <List.Item>
                    <Space direction="vertical" size={2}>
                      <Typography.Text>
                        {item.work_date} · {item.actual_employee_name} · {item.hours} 小时
                      </Typography.Text>
                      <Typography.Text type="secondary">{item.work_content}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </div>
        </Space>
      )}
    </Drawer>
  );
}

function AutoSaveProgressInput({
  row,
  saving,
  onSave
}: {
  row: CaseSubTask;
  saving: boolean;
  onSave: (id: string, progress: number) => void;
}) {
  const originalProgress = Math.round(row.progress);
  const [value, setValue] = useState<number | null>(originalProgress);

  useEffect(() => {
    setValue(originalProgress);
  }, [row.id, originalProgress]);

  const saveIfChanged = () => {
    const nextProgress = normalizeProgress(value);
    setValue(nextProgress);
    if (nextProgress === originalProgress) return;
    onSave(row.id, nextProgress);
  };

  return (
    <InputNumber
      min={0}
      max={100}
      addonAfter="%"
      size="small"
      style={{ width: 96 }}
      value={value}
      disabled={saving}
      onChange={(nextValue) => setValue(typeof nextValue === 'number' ? nextValue : null)}
      onBlur={saveIfChanged}
      onPressEnter={(event) => event.currentTarget.blur()}
    />
  );
}

function normalizeProgress(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
