import { ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TaskDrawer } from '../../components/drawers/TaskDrawer';
import { ProgressCell } from '../../components/matrix/ProgressCell';
import { fetchCaseMatrix, fetchCases } from '../../services/cases';
import type { MatrixColumn, MatrixRow, ProjectCase } from '../../types';
import { statusColor, statusLabel } from '../../utils/labels';

export function CaseMatrixPage() {
  const [searchParams] = useSearchParams();
  const caseIdFromQuery = searchParams.get('caseId') ?? undefined;
  const [selectedCaseId, setSelectedCaseId] = useState<string>();
  const [openedTaskId, setOpenedTaskId] = useState<string>();

  const casesQuery = useQuery({
    queryKey: ['cases'],
    queryFn: fetchCases
  });

  const cases = casesQuery.data ?? [];
  const activeCaseId = selectedCaseId ?? caseIdFromQuery ?? cases[0]?.id;

  const matrixQuery = useQuery({
    queryKey: ['matrix', activeCaseId],
    queryFn: () => fetchCaseMatrix(activeCaseId!),
    enabled: Boolean(activeCaseId)
  });

  const tableColumns = useMemo(() => buildColumns(matrixQuery.data?.columns ?? [], setOpenedTaskId), [matrixQuery.data?.columns]);
  const rows = matrixQuery.data?.rows ?? [];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="page-toolbar">
        <Space wrap>
          <Typography.Title level={4} style={{ margin: 0 }}>
            项目进度总览
          </Typography.Title>
          <Select
            value={activeCaseId}
            style={{ width: 340 }}
            loading={casesQuery.isLoading}
            onChange={setSelectedCaseId}
            options={cases.map((item: ProjectCase) => ({
              value: item.id,
              label: `${item.name}（${Math.round(item.total_progress)}%）`
            }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => matrixQuery.refetch()}>
            刷新
          </Button>
          {matrixQuery.data?.projectCase && (
            <>
              <Tag color={statusColor(matrixQuery.data.projectCase.status)}>
                {statusLabel(matrixQuery.data.projectCase.status)}
              </Tag>
              <Typography.Text type="secondary">
                总进度 {Math.round(matrixQuery.data.projectCase.total_progress)}%
              </Typography.Text>
            </>
          )}
        </Space>
      </Card>

      <Card className="matrix-card">
        <Table
          rowKey="case_item_id"
          loading={matrixQuery.isLoading}
          columns={tableColumns}
          dataSource={rows}
          pagination={false}
          size="small"
          bordered
          scroll={{ x: 1800, y: 'calc(100vh - 250px)' }}
          rowClassName={(row) => (row.open_exception_count > 0 ? 'row-has-exception' : '')}
        />
      </Card>

      <TaskDrawer
        taskId={openedTaskId}
        open={Boolean(openedTaskId)}
        onClose={() => setOpenedTaskId(undefined)}
        matrixCaseId={activeCaseId}
      />
    </Space>
  );
}

function buildColumns(columns: MatrixColumn[], openTask: (taskId: string) => void): ColumnsType<MatrixRow> {
  const fixedKeys = new Set(['case_name', 'case_item_name', 'business_owner_name', 'design_owner_name', 'delivery_status', 'open_exception_count']);
  const fixedColumns: ColumnsType<MatrixRow> = columns
    .filter((column) => fixedKeys.has(column.key))
    .map((column) => ({
      title: column.title,
      dataIndex: column.key,
      key: column.key,
      fixed: 'left',
      width: column.key === 'case_name' ? 220 : column.key === 'case_item_name' ? 180 : 120,
      render: (_value, row) => renderFixedCell(column.key, row)
    }));

  const groups = new Map<string, MatrixColumn[]>();
  for (const column of columns.filter((item) => !fixedKeys.has(item.key))) {
    const group = column.group ?? '其他';
    groups.set(group, [...(groups.get(group) ?? []), column]);
  }

  const groupedColumns: ColumnsType<MatrixRow> = Array.from(groups.entries()).map(([group, children]) => ({
    title: group,
    key: group,
    children: children.map((child) => ({
      title: child.title,
      key: child.key,
      width: 112,
      align: 'center',
      render: (_value: unknown, row: MatrixRow) => (
        <ProgressCell cell={row.cells[child.key]} onOpenTask={openTask} />
      )
    }))
  }));

  return [...fixedColumns, ...groupedColumns];
}

function renderFixedCell(key: string, row: MatrixRow) {
  const cell = row.cells[key];
  const value = cell?.value;
  if (key === 'open_exception_count') {
    const count = Number(value ?? 0);
    return count > 0 ? <Tag color="red">{count}</Tag> : <span className="empty-cell">0</span>;
  }
  return value ? <span>{String(value)}</span> : <span className="empty-cell">-</span>;
}
