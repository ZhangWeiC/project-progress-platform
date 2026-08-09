import { Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { ProgressLogDetail, ProgressLogOperation, ProgressLogResponse } from '../../types';

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  manual_edit: { label: '单项更新', color: 'blue' },
  project_bulk_edit: { label: '批量更新', color: 'purple' },
  delivery_required_stage_complete: { label: '发货自动完成', color: 'green' }
};

type Props = {
  data?: ProgressLogResponse;
  loading?: boolean;
  compact?: boolean;
  onPageChange?: (page: number, pageSize: number) => void;
};

export function ProgressLogTable({ data, loading, compact = false, onPageChange }: Props) {
  const columns: ColumnsType<ProgressLogOperation> = compact
    ? [
        { title: '时间', dataIndex: 'created_at', width: 124, render: formatLogTime },
        { title: '变更位置', key: 'location', ellipsis: true, render: (_, row) => <LogLocation operation={row} /> },
        { title: '进度变化', key: 'progress', width: 112, render: (_, row) => <ProgressChange operation={row} /> },
        { title: '操作人', dataIndex: 'changed_by_name', width: 86, ellipsis: true }
      ]
    : [
        { title: '时间', dataIndex: 'created_at', width: 142, render: formatLogTime },
        { title: '子项目', key: 'item', width: 150, ellipsis: true, render: (_, row) => <ItemScope operation={row} /> },
        { title: '阶段 / 工序', key: 'location', width: 210, ellipsis: true, render: (_, row) => <LogLocation operation={row} /> },
        { title: '进度变化', key: 'progress', width: 124, render: (_, row) => <ProgressChange operation={row} /> },
        { title: '操作人', dataIndex: 'changed_by_name', width: 96, ellipsis: true },
        { title: '变更方式', key: 'source', width: 118, render: (_, row) => <SourceTag source={row.source} reason={row.reason} /> }
      ];

  return (
    <Table<ProgressLogOperation>
      rowKey="id"
      size="small"
      loading={loading}
      columns={columns}
      dataSource={data?.items ?? []}
      className="progress-log-table"
      locale={{ emptyText: '暂无进度变更记录' }}
      scroll={compact ? { x: 580 } : { x: 840 }}
      expandable={{
        rowExpandable: (row) => row.details.length > 1,
        expandedRowRender: (row) => <ProgressLogDetails details={row.details} />,
        expandRowByClick: false
      }}
      pagination={compact || !data ? false : {
        current: data.pagination.page,
        pageSize: data.pagination.page_size,
        total: data.pagination.total,
        showSizeChanger: false,
        showTotal: (total) => `共 ${total} 次变更`,
        onChange: onPageChange
      }}
    />
  );
}

function ProgressLogDetails({ details }: { details: ProgressLogDetail[] }) {
  return (
    <div className="progress-log-details">
      {details.map((detail) => (
        <div className="progress-log-detail-row" key={detail.id}>
          <Typography.Text className="progress-log-detail-item" ellipsis={{ tooltip: detail.item_name ?? '项目级' }}>
            {detail.item_name ?? '项目级'}
          </Typography.Text>
          <Typography.Text className="progress-log-detail-location" ellipsis={{ tooltip: detailPath(detail) }}>
            {detailPath(detail)}
          </Typography.Text>
          <Typography.Text strong>{progressText(detail.before_progress)} → {progressText(detail.after_progress)}</Typography.Text>
        </div>
      ))}
    </div>
  );
}

function ItemScope({ operation }: { operation: ProgressLogOperation }) {
  const text = operation.affected_item_count > 1
    ? `${operation.affected_item_count} 个子项目`
    : operation.item_name ?? '项目级';
  return <Typography.Text ellipsis={{ tooltip: text }}>{text}</Typography.Text>;
}

function LogLocation({ operation }: { operation: ProgressLogOperation }) {
  const text = operation.affected_count > 1 && !operation.task_name
    ? `${operation.affected_count} 项进度变更`
    : [operation.task_name, operation.subtask_name].filter(Boolean).join(' / ') || '任务进度';
  return <Typography.Text ellipsis={{ tooltip: text }}>{text}</Typography.Text>;
}

function ProgressChange({ operation }: { operation: ProgressLogOperation }) {
  if (operation.affected_count === 1) {
    return <Typography.Text strong>{progressText(operation.min_before_progress)} → {progressText(operation.min_after_progress)}</Typography.Text>;
  }
  if (operation.min_after_progress === operation.max_after_progress) {
    return <Typography.Text strong>批量更新为 {progressText(operation.min_after_progress)}</Typography.Text>;
  }
  return <Typography.Text strong>{operation.affected_count} 项变更</Typography.Text>;
}

function SourceTag({ source, reason }: { source: string; reason?: string | null }) {
  const config = SOURCE_LABELS[source] ?? { label: '系统更新', color: 'default' };
  const tag = <Tag color={config.color}>{config.label}</Tag>;
  return reason ? <Tooltip title={reason}>{tag}</Tooltip> : tag;
}

function detailPath(detail: ProgressLogDetail) {
  return [detail.task_name, detail.subtask_name].filter(Boolean).join(' / ') || '任务进度';
}

function progressText(value?: number | null) {
  return value === null || value === undefined ? '-' : `${Math.round(value)}%`;
}

function formatLogTime(value: string) {
  return dayjs(value).format('YYYY-MM-DD HH:mm');
}
