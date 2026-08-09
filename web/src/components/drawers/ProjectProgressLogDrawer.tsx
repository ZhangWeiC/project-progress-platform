import { Button, DatePicker, Drawer, Select, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { fetchProjectProgressLogs } from '../../services/cases';
import { ProgressLogTable } from '../progress-logs/ProgressLogTable';

const { RangePicker } = DatePicker;

export type ProjectProgressLogTarget = {
  id: string;
  name: string;
};

type Props = {
  target: ProjectProgressLogTarget | null;
  open: boolean;
  onClose: () => void;
};

export function ProjectProgressLogDrawer({ target, open, onClose }: Props) {
  const [page, setPage] = useState(1);
  const [caseItemId, setCaseItemId] = useState<string>();
  const [taskType, setTaskType] = useState<string>();
  const [changedBy, setChangedBy] = useState<string>();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const params = useMemo(() => ({
    page,
    page_size: 30,
    case_item_id: caseItemId,
    task_type: taskType,
    changed_by: changedBy,
    start_at: dateRange?.[0].startOf('day').toISOString(),
    end_at: dateRange?.[1].endOf('day').toISOString()
  }), [caseItemId, changedBy, dateRange, page, taskType]);
  const query = useQuery({
    queryKey: ['progress-logs', 'project', target?.id, params],
    queryFn: () => fetchProjectProgressLogs(target!.id, params),
    enabled: Boolean(open && target?.id)
  });

  useEffect(() => {
    setPage(1);
    setCaseItemId(undefined);
    setTaskType(undefined);
    setChangedBy(undefined);
    setDateRange(null);
  }, [target?.id]);

  const updateFilter = (setter: (value?: string) => void, value?: string) => {
    setter(value);
    setPage(1);
  };
  const resetFilters = () => {
    setCaseItemId(undefined);
    setTaskType(undefined);
    setChangedBy(undefined);
    setDateRange(null);
    setPage(1);
  };

  return (
    <Drawer
      title={`项目进度变更记录${target?.name ? ` - ${target.name}` : ''}`}
      width={920}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap className="progress-log-filters">
          <RangePicker
            value={dateRange}
            onChange={(value) => {
              setDateRange(value?.[0] && value[1] ? [dayjs(value[0]), dayjs(value[1])] : null);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="子项目"
            value={caseItemId}
            options={query.data?.facets.case_items}
            onChange={(value) => updateFilter(setCaseItemId, value)}
            style={{ width: 160 }}
          />
          <Select
            allowClear
            placeholder="阶段"
            value={taskType}
            options={query.data?.facets.stages}
            onChange={(value) => updateFilter(setTaskType, value)}
            style={{ width: 130 }}
          />
          <Select
            allowClear
            placeholder="操作人"
            value={changedBy}
            options={query.data?.facets.operators}
            onChange={(value) => updateFilter(setChangedBy, value)}
            style={{ width: 130 }}
          />
          <Button onClick={resetFilters}>重置</Button>
          <Typography.Text type="secondary">共 {query.data?.pagination.total ?? 0} 次变更</Typography.Text>
        </Space>
        <ProgressLogTable
          data={query.data}
          loading={query.isLoading}
          onPageChange={(nextPage) => setPage(nextPage)}
        />
      </Space>
    </Drawer>
  );
}
