import { LockOutlined, WarningOutlined } from '@ant-design/icons';
import { Button, Progress, Space, Tooltip } from 'antd';
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

  if (cell.targetId && cell.taskId) {
    return (
      <Button
        className="progress-cell"
        type="text"
        size="small"
        onClick={() => onOpenTask?.(cell.taskId!)}
      >
        <Space size={4}>
          {value === null ? (
            <span className="empty-cell">-</span>
          ) : (
            <Progress
              percent={Math.round(value)}
              size="small"
              strokeWidth={5}
              status={value >= 100 ? 'success' : value <= 0 ? 'normal' : 'active'}
              format={(percent) => `${percent}%`}
            />
          )}
          {!editable && (
            <Tooltip title="当前用户不可编辑">
              <LockOutlined className="muted-icon" />
            </Tooltip>
          )}
        </Space>
        {cell.ownerName && <span className="progress-owner">{cell.ownerName}</span>}
      </Button>
    );
  }

  if (isAggregate && value !== null) {
    return (
      <div className="progress-cell-summary">
        <Progress
          percent={Math.round(value)}
          size="small"
          strokeWidth={5}
          status={value >= 100 ? 'success' : value <= 0 ? 'normal' : 'active'}
        />
        {cell.ownerName && <span className="progress-owner">{cell.ownerName}</span>}
      </div>
    );
  }

  if (cell.value === 0 && cell.status === 'exception') {
    return <WarningOutlined />;
  }

  if (typeof cell.value === 'number') {
    return <span>{cell.value}</span>;
  }

  if (cell.value === null || cell.value === '') {
    return <span className="empty-cell">-</span>;
  }

  return <span>{String(cell.value)}</span>;
}
