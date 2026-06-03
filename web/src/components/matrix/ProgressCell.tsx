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
              type="circle"
              percent={Math.round(value)}
              size={28}
              strokeWidth={10}
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
      </Button>
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
