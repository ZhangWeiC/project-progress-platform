import { CompressOutlined, ExpandAltOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Card, Input, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Key } from 'react';
import { TaskDrawer } from '../../components/drawers/TaskDrawer';
import { ProgressCell } from '../../components/matrix/ProgressCell';
import { fetchAllMatrix } from '../../services/cases';
import type { MatrixCell, MatrixColumn, MatrixRow } from '../../types';

const STAGE_COLORS = ['blue', 'cyan', 'green', 'lime', 'gold', 'orange', 'purple'];

export function CaseMatrixPage() {
  const [openedTaskId, setOpenedTaskId] = useState<string>();
  const [expandedRowKeys, setExpandedRowKeys] = useState<Key[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');

  const matrixQuery = useQuery({
    queryKey: ['matrix', 'all'],
    queryFn: fetchAllMatrix
  });

  const rows = matrixQuery.data?.rows ?? [];
  const projectRowKeys = useMemo(() => rows.map((row) => row.row_id ?? row.case_item_id), [rows]);

  const filteredRows = useMemo(() => filterRows(rows, searchKeyword), [rows, searchKeyword]);
  const activeExpandedRowKeys = searchKeyword.trim()
    ? filteredRows.map((row) => row.row_id ?? row.case_item_id)
    : expandedRowKeys;
  const tableColumns = useMemo(() => buildColumns(matrixQuery.data?.columns ?? [], setOpenedTaskId), [matrixQuery.data?.columns]);

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="page-toolbar">
        <div className="page-title-row">
          <Space wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>
              项目进度总表
            </Typography.Title>
            <Tag color="blue">{matrixQuery.data?.summary?.project_count ?? 0} 项目</Tag>
            <Tag color="geekblue">{matrixQuery.data?.summary?.item_count ?? 0} 子项目</Tag>
            <Tag color={matrixQuery.data?.summary?.open_exception_count ? 'red' : 'default'}>
              {matrixQuery.data?.summary?.open_exception_count ?? 0} 异常
            </Tag>
          </Space>
          <Space wrap>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索项目 / 子项目 / 负责人"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              style={{ width: 280 }}
            />
            <Button icon={<ExpandAltOutlined />} onClick={() => setExpandedRowKeys(projectRowKeys)}>
              展开
            </Button>
            <Button icon={<CompressOutlined />} onClick={() => setExpandedRowKeys([])}>
              折叠
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => matrixQuery.refetch()}>
              刷新
            </Button>
          </Space>
        </div>
      </Card>

      <Card className="matrix-card">
        <Table<MatrixRow>
          rowKey={(row) => row.row_id ?? row.case_item_id}
          loading={matrixQuery.isLoading}
          columns={tableColumns}
          dataSource={filteredRows}
          pagination={false}
          size="small"
          bordered
          sticky
          tableLayout="fixed"
          scroll={{ x: 2440, y: 'calc(100vh - 178px)' }}
          expandable={{
            expandedRowKeys: activeExpandedRowKeys,
            onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys]),
            indentSize: 14
          }}
          rowClassName={(row) => {
            const classes = [row.row_type === 'project' ? 'matrix-project-row' : 'matrix-item-row'];
            if (row.open_exception_count > 0) classes.push('row-has-exception');
            return classes.join(' ');
          }}
        />
      </Card>

      <TaskDrawer
        taskId={openedTaskId}
        open={Boolean(openedTaskId)}
        onClose={() => setOpenedTaskId(undefined)}
      />
    </Space>
  );
}

function buildColumns(columns: MatrixColumn[], openTask: (taskId: string) => void): ColumnsType<MatrixRow> {
  const leftColumns = columns
    .filter((column) => column.frozen === 'left')
    .map((column) => ({
      title: column.title,
      dataIndex: column.key,
      key: column.key,
      fixed: 'left' as const,
      width: column.key === 'case_name' ? 220 : 190,
      className: `matrix-fixed-left matrix-column-${column.key}`,
      render: (_value: unknown, row: MatrixRow) => renderPinnedCell(column.key, row)
    }));

  const rightColumns = columns
    .filter((column) => column.frozen === 'right')
    .map((column) => ({
      title: column.title,
      dataIndex: column.key,
      key: column.key,
      fixed: 'right' as const,
      width: column.key === 'delivery_status' ? 126 : 70,
      className: 'matrix-fixed-right',
      render: (_value: unknown, row: MatrixRow) => renderPinnedCell(column.key, row)
    }));

  const groups = new Map<string, MatrixColumn[]>();
  for (const column of columns.filter((item) => !item.frozen)) {
    const group = column.group ?? '其他';
    groups.set(group, [...(groups.get(group) ?? []), column]);
  }

  const groupedColumns: ColumnsType<MatrixRow> = Array.from(groups.entries()).map(([group, children], groupIndex) => {
    const stageColor = STAGE_COLORS[groupIndex % STAGE_COLORS.length];
    return {
      title: <span className="stage-title">{group}</span>,
      key: group,
      className: `matrix-stage-group stage-${stageColor}`,
      onHeaderCell: () => ({ className: `matrix-stage-header stage-${stageColor}` }),
      children: children.map((child) => ({
        title: child.title,
        key: child.key,
        width: 82,
        align: 'center' as const,
        className: `matrix-stage-cell stage-${stageColor}`,
        onHeaderCell: () => ({ className: `matrix-substage-header stage-${stageColor}` }),
        onCell: () => ({ className: `matrix-stage-cell stage-${stageColor}` }),
        render: (_value: unknown, row: MatrixRow) => (
          <ProgressCell cell={row.cells[child.key]} onOpenTask={openTask} />
        )
      }))
    };
  });

  return [...leftColumns, ...groupedColumns, ...rightColumns];
}

function renderPinnedCell(key: string, row: MatrixRow) {
  const cell = row.cells[key];
  const value = cell?.value;
  if (key === 'open_exception_count') {
    const count = Number(value ?? 0);
    return count > 0 ? <Tag color="red">{count}</Tag> : <span className="empty-cell">0</span>;
  }
  if (key === 'case_name') {
    const text = value ? String(value) : row.row_type === 'item' ? '' : '-';
    return (
      <Space direction="vertical" size={0} className="matrix-row-title">
        <EllipsisText text={text} strong={row.row_type === 'project'} />
        {row.row_type === 'project' && cell?.ownerName && (
          <EllipsisText text={cell.ownerName} type="secondary" />
        )}
      </Space>
    );
  }
  if (key === 'case_item_name') {
    const text = value ? String(value) : '-';
    return (
      <Space direction="vertical" size={0} className="matrix-row-title">
        <EllipsisText text={text} strong={row.row_type === 'project'} className={!value ? 'empty-cell' : undefined} />
        {row.row_type === 'item' && typeof cell?.aggregateCount === 'number' && (
          <EllipsisText text={`${cell.aggregateCount}%`} type="secondary" />
        )}
      </Space>
    );
  }
  return value ? <EllipsisText text={String(value)} /> : <span className="empty-cell">-</span>;
}

type EllipsisTextProps = {
  text: string;
  strong?: boolean;
  type?: 'secondary';
  className?: string;
};

function EllipsisText({ text, strong, type, className }: EllipsisTextProps) {
  const content = (
    <Typography.Text
      strong={strong}
      type={type}
      className={['matrix-ellipsis-text', className].filter(Boolean).join(' ')}
    >
      {text}
    </Typography.Text>
  );
  if (!text || text === '-') return content;
  return <Tooltip title={text}>{content}</Tooltip>;
}

function filterRows(rows: MatrixRow[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return rows;
  const matchedRows: MatrixRow[] = [];
  for (const row of rows) {
    const children = row.children?.filter((child) => rowMatches(child, normalizedKeyword)) ?? [];
    if (rowMatches(row, normalizedKeyword) || children.length > 0) {
      matchedRows.push({ ...row, children: children.length > 0 ? children : row.children });
    }
  }
  return matchedRows;
}

function rowMatches(row: MatrixRow, keyword: string) {
  return Object.values(row.cells).some((cell: MatrixCell) => {
    const values = [cell.value, cell.ownerName, cell.departmentName];
    return values.some((value) => String(value ?? '').toLowerCase().includes(keyword));
  });
}
