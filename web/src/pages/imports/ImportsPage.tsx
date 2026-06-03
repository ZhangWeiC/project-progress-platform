import { UploadOutlined } from '@ant-design/icons';
import { Button, Card, Space, Steps, Table, Typography, Upload } from 'antd';
import { useState } from 'react';

export function ImportsPage() {
  const [fileName, setFileName] = useState<string>();

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div className="page-title-row">
        <Typography.Title level={4} style={{ margin: 0 }}>Excel 导入</Typography.Title>
        <Upload
          accept=".xlsx,.xls"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(file) => {
            setFileName(file.name);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} type="primary">选择项目进度表</Button>
        </Upload>
      </div>
      <Card>
      <Steps
        current={fileName ? 1 : 0}
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
            issue_type: '进度数值需确认',
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
    </Space>
  );
}
