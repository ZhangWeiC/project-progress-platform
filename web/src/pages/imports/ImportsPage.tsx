import { CheckCircleOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Card, Col, Progress, Row, Space, Statistic, Steps, Table, Tag, Typography, Upload, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { confirmImportTask, uploadImportTask } from '../../services/cases';
import type { ImportIssue, ImportPreviewRow, ImportTaskPreview } from '../../types';
import { statusColor, statusLabel } from '../../utils/labels';

export function ImportsPage() {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<ImportTaskPreview>();

  const uploadMutation = useMutation({
    mutationFn: uploadImportTask,
    onSuccess: (data) => {
      setPreview(data);
      message.success(`已解析 ${data.parsed_cases} 个项目、${data.parsed_items} 个子项目`);
    },
    onError: (error) => message.error(error.message)
  });

  const confirmMutation = useMutation({
    mutationFn: (importTaskId: string) => confirmImportTask(importTaskId),
    onSuccess: async (_result) => {
      message.success('已确认入库');
      setPreview((current) => current ? { ...current, status: 'confirmed' } : current);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
        queryClient.invalidateQueries({ queryKey: ['workbench'] }),
        queryClient.invalidateQueries({ queryKey: ['work-logs'] }),
        queryClient.invalidateQueries({ queryKey: ['exceptions'] })
      ]);
    },
    onError: (error) => message.error(error.message)
  });

  const currentStep = !preview ? 0 : preview.status === 'confirmed' ? 2 : 1;
  const issueCount = preview?.issue_count ?? 0;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div className="page-title-row">
        <Typography.Title level={4} style={{ margin: 0 }}>Excel 导入</Typography.Title>
        <Space>
          <Upload
            accept=".xlsx,.xls"
            maxCount={1}
            showUploadList={false}
            beforeUpload={(file) => {
              uploadMutation.mutate(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} type="primary" loading={uploadMutation.isPending}>
              选择项目进度表
            </Button>
          </Upload>
          <Button
            icon={<CheckCircleOutlined />}
            disabled={!preview || preview.status === 'confirmed'}
            loading={confirmMutation.isPending}
            onClick={() => preview && confirmMutation.mutate(preview.id)}
          >
            确认入库
          </Button>
        </Space>
      </div>

      <Card>
        <Steps
          current={currentStep}
          items={[
            { title: '上传 Excel' },
            { title: '预览与异常确认' },
            { title: '确认入库' }
          ]}
        />
      </Card>

      {preview && (
        <Row gutter={12}>
          <Col xs={12} lg={6}><Card size="small"><Statistic title="文件" value={preview.file_name} /></Card></Col>
          <Col xs={12} lg={6}><Card size="small"><Statistic title="项目数" value={preview.parsed_cases} /></Card></Col>
          <Col xs={12} lg={6}><Card size="small"><Statistic title="子项目数" value={preview.parsed_items} /></Card></Col>
          <Col xs={12} lg={6}><Card size="small"><Statistic title="需确认项" value={issueCount} /></Card></Col>
        </Row>
      )}

      {preview && (
        <Card
          title="解析预览"
          extra={<Tag color={statusColor(preview.status)}>{statusLabel(preview.status)}</Tag>}
        >
          <Table<ImportPreviewRow>
            rowKey="source_row"
            size="small"
            dataSource={preview.preview_rows.slice(0, 80)}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            columns={[
              { title: '行', dataIndex: 'source_row', width: 70 },
              { title: '项目', dataIndex: 'project_name' },
              { title: '子项目', dataIndex: 'item_name' },
              {
                title: '进度',
                dataIndex: 'item_progress',
                width: 150,
                render: (value) => <Progress percent={Math.round(Number(value ?? 0))} size="small" />
              },
              { title: '发货时间', dataIndex: 'delivery_date', width: 150 },
              { title: '发货情况', dataIndex: 'delivery_status', width: 150, render: (value) => value || '-' }
            ]}
          />
        </Card>
      )}

      {preview && (
        <Card title="异常确认">
          <Table<ImportIssue>
            rowKey={(row) => `${row.source_row}-${row.source_column}-${row.field_name}`}
            size="small"
            dataSource={preview.issues}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            locale={{ emptyText: '没有需要确认的异常' }}
            columns={[
              { title: '行', dataIndex: 'source_row', width: 70 },
              { title: '列', dataIndex: 'source_column', width: 70 },
              { title: '字段', dataIndex: 'field_name', width: 160 },
              { title: '原值', dataIndex: 'raw_value', width: 180 },
              { title: '问题', dataIndex: 'issue_type', width: 140 },
              { title: '处理方式', dataIndex: 'suggestion' }
            ]}
          />
        </Card>
      )}
    </Space>
  );
}
