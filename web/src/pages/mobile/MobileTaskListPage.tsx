import { Button, Card, Drawer, Empty, InputNumber, Progress, Space, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMyTasks, fetchTaskDetails, updateSubtaskProgress, updateTaskProgress } from '../../services/cases';
import type { CaseSubTask } from '../../types';
import { statusColor, statusLabel } from '../../utils/labels';

export function MobileTaskListPage() {
  const navigate = useNavigate();
  const [editingTaskId, setEditingTaskId] = useState<string>();
  const query = useQuery({ queryKey: ['my-tasks'], queryFn: fetchMyTasks });
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Title level={4}>我的任务</Typography.Title>
      {!query.isLoading && (query.data ?? []).length === 0 && (
        <Card className="mobile-card">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />
        </Card>
      )}
      {(query.data ?? []).map((task) => (
        <Card key={String(task.id)} size="small" className="mobile-card">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space>
              <Tag color={statusColor(task.status)}>{statusLabel(task.status)}</Tag>
              <Typography.Text strong>{String(task.name)}</Typography.Text>
            </Space>
            <Typography.Text type="secondary" className="mobile-muted-line">{String(task.case_name)} / {String(task.item_name ?? '-')}</Typography.Text>
            <Progress percent={Math.round(Number(task.progress ?? 0))} size="small" />
            <Space wrap>
              <Button size="small" onClick={() => navigate(`/m/cases/${task.project_case_id}`)}>看项目</Button>
              <Button size="small" type="primary" onClick={() => setEditingTaskId(String(task.id))}>填进度</Button>
              <Button size="small" onClick={() => navigate('/m/work-logs/new')}>录日报</Button>
              <Button size="small" onClick={() => navigate('/m/exceptions')}>报异常</Button>
            </Space>
          </Space>
        </Card>
      ))}
      <MobileProgressDrawer taskId={editingTaskId} open={Boolean(editingTaskId)} onClose={() => setEditingTaskId(undefined)} />
    </Space>
  );
}

function MobileProgressDrawer({ taskId, open, onClose }: { taskId?: string; open: boolean; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['mobile-task-details', taskId],
    queryFn: () => fetchTaskDetails(taskId!),
    enabled: Boolean(taskId)
  });
  const details = query.data;
  const subtasks = details?.subtasks ?? [];

  return (
    <Drawer
      title="填写进度"
      placement="bottom"
      height="78vh"
      open={open}
      onClose={onClose}
      destroyOnClose
      className="mobile-progress-drawer"
    >
      {query.isLoading && <Card className="mobile-card">加载中...</Card>}
      {details && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Card size="small" className="mobile-card">
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Typography.Text strong className="mobile-card-title">{details.task.name}</Typography.Text>
              <Typography.Text type="secondary" className="mobile-muted-line">
                {details.task.case_name} / {details.task.item_name ?? '-'}
              </Typography.Text>
              <Progress percent={Math.round(Number(details.task.progress ?? 0))} size="small" />
            </Space>
          </Card>
          {subtasks.length > 0 ? (
            subtasks.map((subtask) => (
              <SubtaskProgressCard key={subtask.id} taskId={details.task.id} subtask={subtask} />
            ))
          ) : (
            <Card size="small" className="mobile-card">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text strong>任务进度</Typography.Text>
                <ProgressQuickEditor
                  targetId={details.task.id}
                  progress={Number(details.task.progress ?? 0)}
                  queryKeys={[['mobile-task-details', taskId], ['my-tasks'], ['mobile-workbench'], ['matrix']]}
                  onSave={updateTaskProgress}
                />
              </Space>
            </Card>
          )}
        </Space>
      )}
    </Drawer>
  );
}

function SubtaskProgressCard({ taskId, subtask }: { taskId: string; subtask: CaseSubTask }) {
  return (
    <Card size="small" className="mobile-card">
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div className="mobile-project-title-row">
          <Typography.Text strong className="mobile-card-title">{subtask.name}</Typography.Text>
          <Tag color={statusColor(subtask.status)}>{statusLabel(subtask.status)}</Tag>
        </div>
        <ProgressQuickEditor
          targetId={subtask.id}
          progress={Number(subtask.progress ?? 0)}
          queryKeys={[['mobile-task-details', taskId], ['my-tasks'], ['mobile-workbench'], ['matrix']]}
          onSave={updateSubtaskProgress}
        />
      </Space>
    </Card>
  );
}

function ProgressQuickEditor({
  targetId,
  progress,
  queryKeys,
  onSave
}: {
  targetId: string;
  progress: number;
  queryKeys: unknown[][];
  onSave: (targetId: string, progress: number) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(Math.round(Number(progress ?? 0)));
  const mutation = useMutation({
    mutationFn: (nextProgress: number) => onSave(targetId, nextProgress),
    onSuccess: async () => {
      message.success('进度已保存');
      await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    onError: (error) => message.error(error.message)
  });

  useEffect(() => {
    setValue(Math.round(Number(progress ?? 0)));
  }, [progress]);

  const save = (nextValue = value) => {
    const normalized = Math.max(0, Math.min(100, Math.round(Number(nextValue) || 0)));
    setValue(normalized);
    if (normalized !== Math.round(Number(progress ?? 0))) mutation.mutate(normalized);
  };

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Progress percent={value} size="small" />
      <div className="mobile-progress-editor">
        <InputNumber
          min={0}
          max={100}
          value={value}
          addonAfter="%"
          controls={false}
          onChange={(nextValue) => setValue(Number(nextValue ?? 0))}
          onBlur={() => save()}
          disabled={mutation.isPending}
        />
        <Space size={6} wrap className="mobile-progress-presets">
          {[25, 50, 75, 100].map((preset) => (
            <Button
              key={preset}
              size="small"
              type={value === preset ? 'primary' : 'default'}
              loading={mutation.isPending && value === preset}
              onClick={() => save(preset)}
            >
              {preset}%
            </Button>
          ))}
        </Space>
      </div>
    </Space>
  );
}
