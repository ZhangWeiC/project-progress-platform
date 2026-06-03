import { Button, Card, Col, Row, Space, Statistic, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchWorkbench } from '../../services/cases';

export function MobileHomePage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['mobile-workbench'], queryFn: fetchWorkbench });
  const counts = query.data?.counts;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Title level={4}>现场工作台</Typography.Title>
      <Row gutter={8}>
        <Col span={8}><Card size="small"><Statistic title="我的任务" value={counts?.tasks ?? 0} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="待处理异常" value={counts?.exceptions ?? 0} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="临期" value={counts?.overdue ?? 0} /></Card></Col>
      </Row>
      <Card size="small" title="快捷入口">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button block type="primary" onClick={() => navigate('/m/work-logs/new')}>录入日报</Button>
          <Button block onClick={() => navigate('/m/tasks')}>查看我的任务</Button>
          <Button block onClick={() => navigate('/m/exceptions')}>处理异常</Button>
        </Space>
      </Card>
    </Space>
  );
}
