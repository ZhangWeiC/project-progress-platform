import { LockOutlined } from '@ant-design/icons';
import { Button, Card, Drawer, Empty, InputNumber, Progress, Space, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchCaseMatrix, updateSubtaskProgress, updateTaskProgress } from '../../services/cases';
import type { MatrixCell, MatrixColumn, MatrixRow } from '../../types';

const DELIVERY_STATUS_COLORS: Record<string, string> = {
  已发货: 'success',
  未发货: 'default',
  待发货: 'warning',
  发货中: 'processing',
  其他: 'purple'
};

export function MobileCaseSummaryPage() {
  const { id } = useParams();
  const [editingStage, setEditingStage] = useState<StageEditingState | null>(null);
  const query = useQuery({ queryKey: ['matrix', id], queryFn: () => fetchCaseMatrix(id!), enabled: Boolean(id) });
  const projectCase = query.data?.projectCase;
  const itemRows = collectItemRows(query.data?.rows ?? []);
  const progressColumns = (query.data?.columns ?? []).filter((column) => !column.frozen && column.key !== 'delivery_date' && column.key !== 'delivery_status');

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Title level={4}>项目摘要</Typography.Title>
      {projectCase && (
        <Card className="mobile-card">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Typography.Text strong className="mobile-card-title">{projectCase.name}</Typography.Text>
            <Typography.Text type="secondary" className="mobile-muted-line">
              {[projectCase.business_owner_name ? `业务：${projectCase.business_owner_name}` : null, projectCase.associated_month].filter(Boolean).join(' · ') || '-'}
            </Typography.Text>
            <Progress percent={Math.round(projectCase.total_progress)} />
          </Space>
        </Card>
      )}
      {!query.isLoading && itemRows.length === 0 && (
        <Card className="mobile-card">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无子项目" />
        </Card>
      )}
      {itemRows.map((row) => (
        <ItemCard key={row.case_item_id || row.row_id} row={row} columns={progressColumns} onEditStage={(column, cell) => setEditingStage({ row, column, cell })} />
      ))}
      <StageProgressDrawer projectCaseId={id} stage={editingStage} open={Boolean(editingStage)} onClose={() => setEditingStage(null)} />
    </Space>
  );
}

type StageEditingState = {
  row: MatrixRow;
  column: MatrixColumn;
  cell: MatrixCell;
};

function ItemCard({
  row,
  columns,
  onEditStage
}: {
  row: MatrixRow;
  columns: MatrixColumn[];
  onEditStage: (column: MatrixColumn, cell: MatrixCell) => void;
}) {
  const title = cellText(row.cells.project_item_name) || cellText(row.cells.case_item_name) || '未命名子项目';
  const deliveryStatus = cellText(row.cells.delivery_status);
  const deliveryDate = cellText(row.cells.delivery_date);
  const stages = columns
    .map((column) => ({ column, cell: row.cells[column.key] }))
    .filter(({ cell }) => cell && cell.value !== null && cell.value !== undefined);

  return (
    <Card size="small" className="mobile-card">
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div className="mobile-project-title-row">
          <Typography.Text strong className="mobile-card-title">{title}</Typography.Text>
          {deliveryStatus && <Tag color={DELIVERY_STATUS_COLORS[deliveryStatus] ?? 'default'}>{deliveryStatus}</Tag>}
        </div>
        <Progress percent={Math.round(Number(row.item_progress ?? 0))} size="small" />
        {(deliveryStatus || deliveryDate) && (
          <Typography.Text type="secondary" className="mobile-muted-line">
            {[deliveryDate ? `发货：${deliveryDate}` : null, deliveryStatus].filter(Boolean).join(' · ')}
          </Typography.Text>
        )}
        {stages.length > 0 && (
          <div className="mobile-stage-grid">
            {stages.map(({ column, cell }) => {
              const editable = canEditStage(cell);
              return (
                <button
                  key={column.key}
                  type="button"
                  className={`mobile-stage-button ${editable ? 'is-editable' : 'is-locked'}`}
                  disabled={!editable}
                  onClick={() => onEditStage(column, cell)}
                >
                  <span className="mobile-stage-main">
                    <span className="mobile-stage-name">{column.title}</span>
                    <strong>{progressText(cell)}%</strong>
                  </span>
                  <span className="mobile-stage-owner">
                    {stageOwnerText(cell)}
                    {!editable && <LockOutlined />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Space>
    </Card>
  );
}

function StageProgressDrawer({
  projectCaseId,
  stage,
  open,
  onClose
}: {
  projectCaseId?: string;
  stage: StageEditingState | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(0);
  const currentProgress = stage ? progressValue(stage.cell) : 0;
  const itemName = stage ? cellText(stage.row.cells.case_item_name) || '未命名子项目' : '';
  const mutation = useMutation({
    mutationFn: (nextProgress: number) => {
      if (!stage?.cell.targetId || !stage.cell.targetType) throw new Error('当前阶段缺少可编辑目标');
      if (stage.cell.targetType === 'task') return updateTaskProgress(stage.cell.targetId, nextProgress);
      return updateSubtaskProgress(stage.cell.targetId, nextProgress);
    },
    onSuccess: async () => {
      message.success('进度已保存');
      onClose();
      await Promise.all([
        projectCaseId ? queryClient.invalidateQueries({ queryKey: ['matrix', projectCaseId] }) : Promise.resolve(),
        queryClient.invalidateQueries({ queryKey: ['matrix', 'all'] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-matrix'] }),
        queryClient.invalidateQueries({ queryKey: ['my-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-workbench'] })
      ]);
    },
    onError: (error) => message.error(error.message)
  });

  useEffect(() => {
    setValue(currentProgress);
  }, [currentProgress, stage?.cell.targetId]);

  const save = (nextValue = value) => {
    const normalized = Math.max(0, Math.min(100, Math.round(Number(nextValue) || 0)));
    setValue(normalized);
    if (!stage || normalized === currentProgress) return;
    mutation.mutate(normalized);
  };

  return (
    <Drawer
      title="编辑阶段进度"
      placement="bottom"
      height="58vh"
      open={open}
      onClose={onClose}
      destroyOnClose
      className="mobile-progress-drawer"
    >
      {stage && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Card size="small" className="mobile-card">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text strong className="mobile-card-title">{stage.column.title}</Typography.Text>
              <Typography.Text type="secondary" className="mobile-muted-line">{itemName}</Typography.Text>
              <Typography.Text type="secondary" className="mobile-muted-line">
                负责人：{stageOwnerText(stage.cell)}
              </Typography.Text>
              <Progress percent={value} size="small" />
            </Space>
          </Card>
          <Card size="small" className="mobile-card">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Typography.Text strong>进度</Typography.Text>
              <div className="mobile-progress-editor">
                <InputNumber
                  min={0}
                  max={100}
                  value={value}
                  addonAfter="%"
                  controls={false}
                  onChange={(nextValue) => setValue(Number(nextValue ?? 0))}
                  onBlur={() => save()}
                  disabled={mutation.isPending}
                />
                <Space size={6} wrap className="mobile-progress-presets">
                  {[25, 50, 75, 100].map((preset) => (
                    <Button
                      key={preset}
                      size="small"
                      type={value === preset ? 'primary' : 'default'}
                      loading={mutation.isPending && value === preset}
                      onClick={() => save(preset)}
                    >
                      {preset}%
                    </Button>
                  ))}
                </Space>
              </div>
            </Space>
          </Card>
        </Space>
      )}
    </Drawer>
  );
}

function collectItemRows(rows: MatrixRow[]) {
  const result: MatrixRow[] = [];
  const walk = (items: MatrixRow[]) => {
    for (const row of items) {
      if (isItemRow(row)) result.push(row);
      if (row.children?.length) walk(row.children);
    }
  };
  walk(rows);
  return result;
}

function isItemRow(row: MatrixRow) {
  if (row.row_type === 'item') return true;
  if (row.row_type === 'month' || row.row_type === 'project') return false;
  return Boolean(row.case_item_id && !String(row.case_item_id).startsWith('PROJECT-') && !String(row.case_item_id).startsWith('MONTH-'));
}

function cellText(cell?: MatrixCell) {
  if (cell?.value === null || cell?.value === undefined) return '';
  return String(cell.value);
}

function progressValue(cell?: MatrixCell) {
  return Math.max(0, Math.min(100, Math.round(Number(cell?.value ?? 0) || 0)));
}

function progressText(cell?: MatrixCell) {
  return String(progressValue(cell));
}

function canEditStage(cell?: MatrixCell) {
  return Boolean(cell?.editable && cell.targetId && (cell.targetType === 'subtask' || cell.targetType === 'task'));
}

function stageOwnerText(cell?: MatrixCell) {
  const owners = Array.from(new Set([cell?.ownerName, cell?.departmentName].filter(Boolean)));
  return owners.join(' / ') || '未设置负责人';
}
