import { Button, Card, Progress, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchMyTasks } from '../../services/cases';
import { statusColor, statusLabel } from '../../utils/labels';

export function MobileTaskListPage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['my-tasks'], queryFn: fetchMyTasks });
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Title level={4}>我的任务</Typography.Title>
      {(query.data ?? []).map((task) => (
        <Card key={String(task.id)} size="small" className="mobile-card">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space>
              <Tag color={statusColor(task.status)}>{statusLabel(task.status)}</Tag>
              <Typography.Text strong>{String(task.name)}</Typography.Text>
            </Space>
            <Typography.Text type="secondary">{String(task.case_name)} / {String(task.item_name ?? '-')}</Typography.Text>
            <Progress percent={Math.round(Number(task.progress ?? 0))} size="small" />
            <Space>
              <Button size="small" type="primary" onClick={() => navigate('/m/work-logs/new')}>录日报</Button>
              <Button size="small" onClick={() => navigate('/m/exceptions')}>报异常</Button>
            </Space>
          </Space>
        </Card>
      ))}
    </Space>
  );
}
