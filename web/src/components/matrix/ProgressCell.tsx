import { LockOutlined, WarningOutlined } from '@ant-design/icons';
import { Button, Space, Tooltip } from 'antd';
import type { MatrixCell } from '../../types';

type Props = {
  cell?: MatrixCell;
  onOpenTask?: (taskId: string) => void;
};

export function ProgressCell({ cell, onOpenTask }: Props) {
  if (!cell) return <span className="empty-cell">-</span>;
  const value = typeof cell.value === 'number' ? cell.value : null;
  const editable = Boolean(cell.editable);
  const isAggregate = !cell.targetId;
  const owner = cell.ownerMerged ? '' : cell.ownerName;
  const formattedValue = value === null ? null : `${Math.round(value)}%`;
  const valueClassName = `progress-value ${progressValueClassName(cell, value)}`;
  const timing = value === null ? null : <ProgressTiming cell={cell} />;

  if (cell.targetId && cell.taskId) {
    return (
      <Button
        className="progress-cell"
        type="text"
        size="small"
        onClick={() => onOpenTask?.(cell.taskId!)}
      >
        <Space size={4} className="progress-cell-main">
          {formattedValue === null ? <span className="empty-cell">-</span> : <span className={valueClassName}>{formattedValue}</span>}
          {!editable && (
            <Tooltip title="当前用户不可编辑">
              <LockOutlined className="muted-icon" />
            </Tooltip>
          )}
        </Space>
        {owner && (
          <Tooltip title={owner}>
            <span className="progress-owner">{owner}</span>
          </Tooltip>
        )}
        {timing}
      </Button>
    );
  }

  if (isAggregate && value !== null) {
    return (
      <div className="progress-cell-summary">
        <span className={valueClassName}>{formattedValue}</span>
        {owner && (
          <Tooltip title={owner}>
            <span className="progress-owner">{owner}</span>
          </Tooltip>
        )}
        {timing}
      </div>
    );
  }

  if (cell.value === 0 && cell.status === 'exception') {
    return <WarningOutlined className="progress-warning" />;
  }

  if (typeof cell.value === 'number') {
    return (
      <span className="progress-cell-inline">
        <span className={valueClassName}>{formattedValue}</span>
        {timing}
      </span>
    );
  }

  if (cell.value === null || cell.value === '') {
    return <span className="empty-cell">-</span>;
  }

  return <span>{String(cell.value)}</span>;
}

function progressValueClassName(cell: MatrixCell, value: number | null) {
  if (cell.status === 'exception') return 'progress-value-exception';
  if (value === null) return '';
  if (value >= 100) return 'progress-value-completed';
  if (value > 0) return 'progress-value-active';
  return 'progress-value-empty';
}

function ProgressTiming({ cell }: { cell: MatrixCell }) {
  const start = formatShortDateTime(cell.progress_started_at);
  const finish = formatShortDateTime(cell.progress_finished_at);
  const title = (
    <Space direction="vertical" size={0}>
      <span>开始时间：{formatFullDateTime(cell.progress_started_at)}</span>
      <span>结束时间：{formatFullDateTime(cell.progress_finished_at)}</span>
    </Space>
  );
  return (
    <Tooltip title={title}>
      <span className="progress-cell-time">
        <span>始 {start}</span>
        <span>完 {finish}</span>
      </span>
    </Tooltip>
  );
}

function formatShortDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(5, 10) || value;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatFullDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}
