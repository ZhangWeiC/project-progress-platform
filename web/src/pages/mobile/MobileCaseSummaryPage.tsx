import { Card, Empty, Progress, Space, Tag, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchCaseMatrix } from '../../services/cases';
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
        <ItemCard key={row.case_item_id || row.row_id} row={row} columns={progressColumns} />
      ))}
    </Space>
  );
}

function ItemCard({ row, columns }: { row: MatrixRow; columns: MatrixColumn[] }) {
  const title = cellText(row.cells.project_item_name) || cellText(row.cells.case_item_name) || '未命名子项目';
  const deliveryStatus = cellText(row.cells.delivery_status);
  const deliveryDate = cellText(row.cells.delivery_date);
  const stages = columns
    .map((column) => ({ column, cell: row.cells[column.key] }))
    .filter(({ cell }) => cell && cell.value !== null && cell.value !== undefined)
    .slice(0, 8);

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
          <div className="mobile-stage-chip-list">
            {stages.map(({ column, cell }) => (
              <Tag key={column.key} className="mobile-stage-chip">
                {column.title} {cellText(cell)}%
              </Tag>
            ))}
          </div>
        )}
      </Space>
    </Card>
  );
}

function collectItemRows(rows: MatrixRow[]) {
  const result: MatrixRow[] = [];
  const walk = (items: MatrixRow[]) => {
    for (const row of items) {
      if (row.row_type === 'item') result.push(row);
      if (row.children?.length) walk(row.children);
    }
  };
  walk(rows);
  return result;
}

function cellText(cell?: MatrixCell) {
  if (cell?.value === null || cell?.value === undefined) return '';
  return String(cell.value);
}
