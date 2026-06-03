import { Card, Col, Row, Statistic, Typography } from 'antd';

export function ReportsPage() {
  return (
    <Card>
      <Typography.Title level={4}>统计报表</Typography.Title>
      <Row gutter={12}>
        <Col span={6}><Statistic title="进行中项目" value={1} /></Col>
        <Col span={6}><Statistic title="未关闭异常" value={1} /></Col>
        <Col span={6}><Statistic title="本周工时" value={8} suffix="小时" /></Col>
        <Col span={6}><Statistic title="延期任务" value={0} /></Col>
      </Row>
    </Card>
  );
}
