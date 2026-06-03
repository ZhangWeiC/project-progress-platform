import { Card, Progress, Space, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchCaseMatrix } from '../../services/cases';

export function MobileCaseSummaryPage() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ['matrix', id], queryFn: () => fetchCaseMatrix(id!), enabled: Boolean(id) });
  const projectCase = query.data?.projectCase;
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Title level={4}>项目摘要</Typography.Title>
      {projectCase && (
        <Card>
          <Typography.Text strong>{projectCase.name}</Typography.Text>
          <Progress percent={Math.round(projectCase.total_progress)} />
        </Card>
      )}
      {(query.data?.rows ?? []).map((row) => (
        <Card key={row.case_item_id} size="small">
          <Typography.Text>{String(row.cells.case_item_name?.value ?? '-')}</Typography.Text>
          <Progress percent={Math.round(row.item_progress)} size="small" />
        </Card>
      ))}
    </Space>
  );
}
