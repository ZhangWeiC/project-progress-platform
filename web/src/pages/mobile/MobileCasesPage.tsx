import { Card, Empty, Input, Progress, Segmented, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAllMatrix } from '../../services/cases';
import type { MatrixCell, MatrixRow } from '../../types';

type ProjectRow = MatrixRow & { mobileMonth: string };
type FilterMode = 'active' | 'shipped' | 'all';
const ACTIVE_DELIVERY_STATUS_FILTER = ['未发货', '待发货', '发货中'];

const DELIVERY_STATUS_COLORS: Record<string, string> = {
  已发货: 'success',
  未发货: 'default',
  待发货: 'warning',
  发货中: 'processing',
  其他: 'purple'
};

export function MobileCasesPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [mode, setMode] = useState<FilterMode>('active');
  const query = useQuery({
    queryKey: ['mobile-matrix', { keyword: keyword.trim(), mode }],
    queryFn: () => fetchAllMatrix({
      page: 1,
      page_size: 100,
      keyword: keyword.trim(),
      delivery_status: mode === 'active' ? ACTIVE_DELIVERY_STATUS_FILTER : mode === 'shipped' ? '已发货' : undefined
    })
  });

  const groups = useMemo(() => groupProjectRows(collectProjectRows(query.data?.rows ?? [])), [query.data?.rows]);

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div className="mobile-page-heading">
        <Typography.Title level={4}>项目进度</Typography.Title>
        <Typography.Text type="secondary">{query.data?.summary?.project_count ?? 0} 项目</Typography.Text>
      </div>
      <Input.Search
        allowClear
        placeholder="搜索项目 / 子项目 / 负责人"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <Segmented
        block
        value={mode}
        onChange={(value) => setMode(value as FilterMode)}
        options={[
          { label: '进行中', value: 'active' },
          { label: '已发货', value: 'shipped' },
          { label: '全部', value: 'all' }
        ]}
      />

      {query.isLoading && <Card className="mobile-card">加载中...</Card>}
      {!query.isLoading && groups.length === 0 && (
        <Card className="mobile-card">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无项目" />
        </Card>
      )}

      {groups.map((group) => (
        <Space direction="vertical" size={8} style={{ width: '100%' }} key={group.month}>
          <Typography.Text strong className="mobile-month-title">{formatMonth(group.month)}</Typography.Text>
          {group.rows.map((row) => (
            <ProjectCard key={row.project_case_id} row={row} onClick={() => navigate(`/m/cases/${row.project_case_id}`)} />
          ))}
        </Space>
      ))}
    </Space>
  );
}

function ProjectCard({ row, onClick }: { row: ProjectRow; onClick: () => void }) {
  const title = cellText(row.cells.project_item_name) || cellText(row.cells.case_name) || '未命名项目';
  const owner = row.cells.project_item_name?.ownerName ?? row.cells.case_name?.ownerName ?? '';
  const itemCount = row.cells.project_item_name?.aggregateCount;
  const deliveryStatus = cellText(row.cells.delivery_status);
  const progress = projectProgress(row);

  return (
    <Card size="small" className="mobile-card mobile-project-card" onClick={onClick}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div className="mobile-project-title-row">
          <Typography.Text strong className="mobile-card-title">{title}</Typography.Text>
          {deliveryStatus && <Tag color={DELIVERY_STATUS_COLORS[deliveryStatus] ?? 'default'}>{deliveryStatus}</Tag>}
        </div>
        <Typography.Text type="secondary" className="mobile-muted-line">
          {[owner ? `负责人：${owner}` : null, typeof itemCount === 'number' ? `${itemCount} 个子项目` : null].filter(Boolean).join(' · ') || '-'}
        </Typography.Text>
        <Progress percent={progress} size="small" />
        <div className="mobile-project-meta-row">
          <Typography.Text type="secondary">异常 {row.open_exception_count ?? 0}</Typography.Text>
          <Typography.Text type="secondary">进入详情</Typography.Text>
        </div>
      </Space>
    </Card>
  );
}

function collectProjectRows(rows: MatrixRow[]) {
  const result: ProjectRow[] = [];
  const walk = (items: MatrixRow[], currentMonth = '未分类') => {
    for (const row of items) {
      const nextMonth = row.row_type === 'month'
        ? cellText(row.cells.project_item_name) || row.associated_month || currentMonth
        : row.associated_month || currentMonth;
      if (row.row_type === 'project') {
        result.push({ ...row, mobileMonth: nextMonth });
      }
      if (row.children?.length) walk(row.children, nextMonth);
    }
  };
  walk(rows);
  return result;
}

function groupProjectRows(rows: ProjectRow[]) {
  const groups = new Map<string, ProjectRow[]>();
  for (const row of rows) {
    groups.set(row.mobileMonth, [...(groups.get(row.mobileMonth) ?? []), row]);
  }
  return Array.from(groups.entries()).map(([month, groupRows]) => ({ month, rows: groupRows }));
}

function projectProgress(row: MatrixRow) {
  const direct = Number(row.item_progress ?? NaN);
  if (Number.isFinite(direct)) return Math.max(0, Math.min(100, Math.round(direct)));
  const stageProgress = Object.values(row.cells)
    .map((cell) => Number(cell.value))
    .filter((value) => Number.isFinite(value));
  if (!stageProgress.length) return 0;
  return Math.round(stageProgress.reduce((sum, value) => sum + value, 0) / stageProgress.length);
}

function cellText(cell?: MatrixCell) {
  if (cell?.value === null || cell?.value === undefined) return '';
  return String(cell.value);
}

function formatMonth(month: string) {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return month;
  return `${match[1]}年${match[2]}月`;
}
