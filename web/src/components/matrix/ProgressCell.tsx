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

  if (cell.targetId && cell.taskId) {
    return (
      <Button
        className="progress-cell"
        type="text"
        size="small"
        onClick={() => onOpenTask?.(cell.taskId!)}
      >
        <Space size={4}>
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
      </div>
    );
  }

  if (cell.value === 0 && cell.status === 'exception') {
    return <WarningOutlined className="progress-warning" />;
  }

  if (typeof cell.value === 'number') {
    return <span className={valueClassName}>{formattedValue}</span>;
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
