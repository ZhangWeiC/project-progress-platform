import { Button, Card, Space, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMyExceptions, patchException } from '../../services/cases';
import { statusColor, statusLabel } from '../../utils/labels';

export function MobileExceptionsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['my-exceptions'], queryFn: fetchMyExceptions });
  const mutation = useMutation({
    mutationFn: (id: string) => patchException(id, { status: 'resolved', resolution: 'H5 标记已处理' }),
    onSuccess: async () => {
      message.success('已标记解决');
      await queryClient.invalidateQueries({ queryKey: ['my-exceptions'] });
    }
  });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Title level={4}>异常处理</Typography.Title>
      {(query.data ?? []).map((item) => (
        <Card key={item.id} size="small" className="mobile-card">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space>
              <Tag color={statusColor(item.status)}>{statusLabel(item.status)}</Tag>
              <Typography.Text strong>{item.title}</Typography.Text>
            </Space>
            <Typography.Text type="secondary">{item.case_name} / {item.item_name ?? '-'} / {item.task_name ?? '-'}</Typography.Text>
            <Typography.Paragraph style={{ marginBottom: 0 }}>{item.description}</Typography.Paragraph>
            <Button block size="small" onClick={() => mutation.mutate(item.id)}>标记解决</Button>
          </Space>
        </Card>
      ))}
    </Space>
  );
}
