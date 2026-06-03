import { Card, Steps, Table, Typography } from 'antd';

export function ImportsPage() {
  return (
    <Card>
      <Typography.Title level={4}>Excel 导入中心</Typography.Title>
      <Steps
        current={1}
        items={[
          { title: '上传 Excel' },
          { title: '预览与异常确认' },
          { title: '确认入库' }
        ]}
      />
      <Table
        style={{ marginTop: 16 }}
        size="small"
        rowKey="source_row"
        dataSource={[
          {
            source_row: 27,
            source_column: 'V',
            field_name: '单片体焊接/完成率%',
            raw_value: '6.66',
            issue_type: 'progress_out_of_range',
            suggestion: '请确认是 6.66%、66.6% 还是录入错误'
          }
        ]}
        columns={[
          { title: '行', dataIndex: 'source_row' },
          { title: '列', dataIndex: 'source_column' },
          { title: '字段', dataIndex: 'field_name' },
          { title: '原值', dataIndex: 'raw_value' },
          { title: '问题', dataIndex: 'issue_type' },
          { title: '建议', dataIndex: 'suggestion' }
        ]}
      />
    </Card>
  );
}
