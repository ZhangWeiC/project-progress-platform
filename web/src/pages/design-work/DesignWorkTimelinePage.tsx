import { DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, Button, Card, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Spin, Statistic, Switch, Tooltip, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import {
  createDesignWorkRecord,
  deleteDesignWorkRecord,
  fetchDesignTimeline,
  fetchDesignWorkLookups,
  updateDesignWorkRecord,
  type DesignWorkPayload,
  type DesignWorkRecord
} from '../../services/designWork';

type FormValues = {
  employee_id: string;
  date_range: [Dayjs, Dayjs];
  work_days?: number;
  work_type_id?: string;
  association_scope: 'none' | 'project' | 'items';
  project_case_id?: string;
  case_item_ids?: string[];
  work_content: string;
  sync_progress?: boolean;
  progress?: number;
};

export function DesignWorkTimelinePage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [range, setRange] = useState(() => thisWeekRange(dayjs()));
  const [employeeFilter, setEmployeeFilter] = useState<string>();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DesignWorkRecord | null>(null);
  const [contentTouched, setContentTouched] = useState(false);
  const dates = useMemo(() => eachDay(range.start, range.end), [range]);
  const lookupsQuery = useQuery({ queryKey: ['design-work-lookups'], queryFn: fetchDesignWorkLookups });
  const timelineQuery = useQuery({
    queryKey: ['design-work-timeline', range.start.format('YYYY-MM-DD'), range.end.format('YYYY-MM-DD'), employeeFilter],
    queryFn: () => fetchDesignTimeline(range.start.format('YYYY-MM-DD'), range.end.format('YYYY-MM-DD'), employeeFilter)
  });
  const normalizedKeyword = searchKeyword.trim().toLocaleLowerCase();
  const visibleRecords = useMemo(() => {
    const records = timelineQuery.data?.records ?? [];
    if (!normalizedKeyword) return records;
    return records.filter((record) => recordMatchesKeyword(record, normalizedKeyword));
  }, [normalizedKeyword, timelineQuery.data?.records]);
  const visibleEmployees = useMemo(() => {
    const employees = timelineQuery.data?.employees ?? [];
    if (!normalizedKeyword) return employees;
    const matchingEmployeeIds = new Set(visibleRecords.map((record) => record.employee_id));
    return employees.filter((employee) => matchingEmployeeIds.has(employee.id));
  }, [normalizedKeyword, timelineQuery.data?.employees, visibleRecords]);
  const visibleSummary = useMemo(() => ({
    recordCount: visibleRecords.length,
    workDays: visibleRecords.reduce((total, record) => total + (record.work_days ?? 0), 0),
    employeeCount: new Set(visibleRecords.map((record) => record.employee_id)).size,
    missingWorkDaysCount: visibleRecords.filter((record) => record.work_days === null || record.work_days === undefined).length
  }), [visibleRecords]);
  const selectedScope = Form.useWatch('association_scope', form);
  const selectedProjectId = Form.useWatch('project_case_id', form);
  const selectedWorkTypeId = Form.useWatch('work_type_id', form);
  const selectedItemIds = Form.useWatch('case_item_ids', form);
  const selectedProject = lookupsQuery.data?.projects.find((project) => project.id === selectedProjectId);
  const selectedWorkType = lookupsQuery.data?.work_types.find((item) => item.id === selectedWorkTypeId);
  const isLeaveWorkType = selectedWorkType?.code === 'leave';
  const canSyncProgress = Boolean(selectedProject && (
    lookupsQuery.data?.current_user.permission_level === 'manager'
    || selectedProject.design_owner_id === lookupsQuery.data?.current_user.id
  ));

  useEffect(() => {
    if (!modalOpen || editingRecord || contentTouched) return;
    if (!selectedProject || !selectedWorkTypeId || selectedScope === 'none') return;
    if (!selectedWorkType) return;
    const itemNames = selectedScope === 'items'
      ? selectedProject.items.filter((item) => selectedItemIds?.includes(item.id)).map((item) => item.name)
      : [];
    form.setFieldValue('work_content', `${selectedProject.name}${itemNames.length ? `-${itemNames.join('、')}` : ''}${selectedWorkType.name}`);
  }, [contentTouched, editingRecord, form, modalOpen, selectedItemIds, selectedProject, selectedScope, selectedWorkType]);

  const saveMutation = useMutation({
    mutationFn: (payload: DesignWorkPayload) => editingRecord
      ? updateDesignWorkRecord(editingRecord.id, payload)
      : createDesignWorkRecord(payload),
    onSuccess: () => {
      message.success(editingRecord ? '工作记录已更新' : '工作记录已添加');
      closeEditor();
      queryClient.invalidateQueries({ queryKey: ['design-work-timeline'] });
    },
    onError: (error) => message.error(error.message)
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDesignWorkRecord(id),
    onSuccess: () => {
      message.success('工作记录已删除');
      closeEditor();
      queryClient.invalidateQueries({ queryKey: ['design-work-timeline'] });
    },
    onError: (error) => message.error(error.message)
  });

  function openCreate(employeeId?: string) {
    const currentUser = lookupsQuery.data?.current_user;
    const defaultEmployeeId = employeeId
      ?? (currentUser?.is_design_employee ? currentUser.id : lookupsQuery.data?.employees[0]?.id);
    setEditingRecord(null);
    setContentTouched(false);
    form.resetFields();
    form.setFieldsValue({
      employee_id: defaultEmployeeId,
      date_range: [dayjs(), dayjs()],
      work_days: 1,
      association_scope: 'none',
      work_content: ''
    });
    setModalOpen(true);
  }

  function openRecord(record: DesignWorkRecord) {
    setEditingRecord(record);
    setContentTouched(true);
    form.resetFields();
    form.setFieldsValue({
      employee_id: record.employee_id,
      date_range: [dayjs(record.start_date), dayjs(record.end_date)],
      work_days: record.work_days ?? undefined,
      work_type_id: record.work_type_id ?? undefined,
      association_scope: record.association_scope,
      project_case_id: record.project_case_id ?? undefined,
      case_item_ids: record.case_items.map((item) => item.id),
      work_content: record.work_content
    });
    setModalOpen(true);
  }

  function closeEditor() {
    setModalOpen(false);
    setEditingRecord(null);
    setContentTouched(false);
    form.resetFields();
  }

  function submitForm(values: FormValues) {
    const payload: DesignWorkPayload = {
      employee_id: values.employee_id,
      project_case_id: values.association_scope === 'none' ? null : values.project_case_id,
      work_type_id: values.work_type_id ?? null,
      association_scope: values.association_scope,
      case_item_ids: values.association_scope === 'items' ? values.case_item_ids : undefined,
      start_date: values.date_range[0].format('YYYY-MM-DD'),
      end_date: values.date_range[1].format('YYYY-MM-DD'),
      work_days: values.work_days ?? null,
      work_content: values.work_content,
      sync_progress: Boolean(values.sync_progress),
      progress: values.sync_progress ? values.progress : undefined
    };
    saveMutation.mutate(payload);
  }

  const canCreate = Boolean(lookupsQuery.data?.current_user.is_design_employee || lookupsQuery.data?.current_user.can_manage_records);
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card className="page-toolbar">
        <div className="page-title-row">
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>设计工作记录</Typography.Title>
            <Typography.Text type="secondary">按人员查看工作时间轴，工时单位为人天，点击记录可查看或编辑</Typography.Text>
          </div>
          <Space wrap>
            <Select
              allowClear
              placeholder="全部人员"
              style={{ width: 150 }}
              value={employeeFilter}
              options={lookupsQuery.data?.employees.map((employee) => ({ value: employee.id, label: employee.name }))}
              onChange={setEmployeeFilter}
            />
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="检索工作内容、人员或项目"
              style={{ width: 240 }}
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
            />
            <DatePicker.RangePicker
              allowClear={false}
              value={[range.start, range.end]}
              format="YYYY-MM-DD"
              onChange={(values) => {
                const start = values?.[0];
                const end = values?.[1];
                if (!start || !end) return;
                if (end.diff(start, 'day') + 1 > 366) {
                  message.warning('单次最多查看 366 天');
                  return;
                }
                setRange({ start: start.startOf('day'), end: end.startOf('day') });
              }}
            />
            <Space.Compact>
              <Button type={rangeMatches(range, thisWeekRange(dayjs())) ? 'primary' : 'default'} onClick={() => setRange(thisWeekRange(dayjs()))}>本周</Button>
              <Button type={rangeMatches(range, lastWeekRange(dayjs())) ? 'primary' : 'default'} onClick={() => setRange(lastWeekRange(dayjs()))}>上周</Button>
              <Button type={rangeMatches(range, thisMonthRange(dayjs())) ? 'primary' : 'default'} onClick={() => setRange(thisMonthRange(dayjs()))}>本月</Button>
            </Space.Compact>
            {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>录入工作</Button>}
          </Space>
        </div>
      </Card>

      <Card className="design-work-summary-card" styles={{ body: { padding: '12px 20px' } }}>
        <div className="design-work-summary">
          <Statistic title="工作记录" value={visibleSummary.recordCount} suffix="条" />
          <Statistic title="已登记人天" value={visibleSummary.workDays} precision={1} suffix="人天" />
          <Statistic title="涉及人员" value={visibleSummary.employeeCount} suffix="人" />
          <Statistic title="未填人天" value={visibleSummary.missingWorkDaysCount} suffix="条" />
        </div>
      </Card>

      {timelineQuery.error ? <Alert type="error" showIcon message={timelineQuery.error.message} /> : null}
      <Card className="design-timeline-card" styles={{ body: { padding: 0 } }}>
        {timelineQuery.isLoading ? (
          <div className="design-timeline-loading"><Spin /></div>
        ) : (timelineQuery.data?.employees.length ?? 0) === 0 ? (
          <Empty description="暂无设计部人员" />
        ) : normalizedKeyword && visibleRecords.length === 0 ? (
          <Empty description="当前时间范围内未找到匹配的工作记录" />
        ) : (
          <DesignTimeline
            dates={dates}
            employees={visibleEmployees}
            records={visibleRecords}
            canCreate={canCreate}
            onCreate={openCreate}
            onOpenRecord={openRecord}
          />
        )}
      </Card>

      <Modal
        title={editingRecord ? (editingRecord.editable ? '编辑工作记录' : '工作记录详情') : '录入工作'}
        open={modalOpen}
        width={640}
        okText={editingRecord?.editable === false ? undefined : '保存'}
        cancelText={editingRecord?.editable === false ? '关闭' : '取消'}
        onCancel={closeEditor}
        onOk={editingRecord?.editable === false ? closeEditor : () => form.submit()}
        confirmLoading={saveMutation.isPending}
        footer={editingRecord?.editable === false ? undefined : (_, { OkBtn, CancelBtn }) => (
          <div className="design-work-modal-footer">
            <div>
              {editingRecord?.deletable ? (
                <Popconfirm title="确认删除这条工作记录？" onConfirm={() => deleteMutation.mutate(editingRecord.id)}>
                  <Button danger icon={<DeleteOutlined />} loading={deleteMutation.isPending}>删除</Button>
                </Popconfirm>
              ) : null}
            </div>
            <Space><CancelBtn /><OkBtn /></Space>
          </div>
        )}
        destroyOnHidden
      >
        {editingRecord?.editable === false ? (
          <RecordDetails record={editingRecord} />
        ) : (
          <Form<FormValues>
            form={form}
            layout="vertical"
            onFinish={submitForm}
            onValuesChange={(changed) => {
              if ('work_content' in changed) setContentTouched(Boolean(changed.work_content));
              if ('project_case_id' in changed) form.setFieldValue('case_item_ids', []);
              if ('work_type_id' in changed) {
                const nextWorkType = lookupsQuery.data?.work_types.find((item) => item.id === changed.work_type_id);
                if (nextWorkType?.code === 'leave') form.setFieldValue('work_days', undefined);
              }
              if (changed.association_scope === 'none') {
                form.setFieldsValue({ project_case_id: undefined, case_item_ids: [], sync_progress: false, progress: undefined });
              }
            }}
          >
            <div className="design-work-form-grid">
              <Form.Item label="人员" name="employee_id" rules={[{ required: true, message: '请选择人员' }]}>
                <Select
                  disabled={!lookupsQuery.data?.current_user.can_manage_records}
                  options={lookupsQuery.data?.employees.map((employee) => ({ value: employee.id, label: employee.name }))}
                />
              </Form.Item>
              <Form.Item label="日期范围" name="date_range" rules={[{ required: true, message: '请选择日期范围' }]}>
                <DatePicker.RangePicker allowClear={false} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                label={isLeaveWorkType ? '人天（休假可不填）' : '人天'}
                name="work_days"
                rules={isLeaveWorkType ? [] : [{ required: true, message: '请输入人天' }]}
              >
                <InputNumber disabled={isLeaveWorkType} min={0.1} precision={1} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="工作类型（可选）" name="work_type_id">
                <Select allowClear options={lookupsQuery.data?.work_types.map((item) => ({ value: item.id, label: item.name }))} />
              </Form.Item>
            </div>
            <Form.Item label="关联范围" name="association_scope">
              <Radio.Group options={[
                { value: 'none', label: '不关联项目' },
                { value: 'project', label: '整个项目' },
                { value: 'items', label: '指定子项目' }
              ]} />
            </Form.Item>
            {selectedScope !== 'none' ? (
              <div className="design-work-form-grid">
                <Form.Item label="项目" name="project_case_id" rules={[{ required: true, message: '请选择项目' }]}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={lookupsQuery.data?.projects.map((project) => ({ value: project.id, label: project.name }))}
                  />
                </Form.Item>
                {selectedScope === 'items' ? (
                  <Form.Item label="子项目" name="case_item_ids" rules={[{ required: true, message: '请选择子项目' }]}>
                    <Select mode="multiple" options={selectedProject?.items.map((item) => ({ value: item.id, label: item.name }))} />
                  </Form.Item>
                ) : <div />}
              </div>
            ) : null}
            <Form.Item
              label="工作内容"
              name="work_content"
              rules={[{ required: true, whitespace: true, message: '请输入工作内容' }]}
              extra={isLeaveWorkType ? '请补充是请假还是法定假期' : '选择项目和工作类型后会自动生成，可直接修改'}
            >
              <Input.TextArea rows={3} placeholder={isLeaveWorkType ? '例如：请假 / 法定假期' : '简要填写本次工作内容'} />
            </Form.Item>
            {selectedScope !== 'none' && canSyncProgress ? (
              <Space align="start" size="large">
                <Form.Item label="同步设计进度" name="sync_progress" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item noStyle shouldUpdate={(previous, current) => previous.sync_progress !== current.sync_progress}>
                  {({ getFieldValue }) => getFieldValue('sync_progress') ? (
                    <Form.Item label="进度" name="progress" rules={[{ required: true, message: '请输入进度' }]}>
                      <InputNumber min={0} max={100} precision={0} />
                    </Form.Item>
                  ) : null}
                </Form.Item>
              </Space>
            ) : null}
          </Form>
        )}
      </Modal>
    </Space>
  );
}

function DesignTimeline({ dates, employees, records, canCreate, onCreate, onOpenRecord }: {
  dates: Dayjs[];
  employees: Array<{ id: string; name: string }>;
  records: DesignWorkRecord[];
  canCreate: boolean;
  onCreate: (employeeId?: string) => void;
  onOpenRecord: (record: DesignWorkRecord) => void;
}) {
  const start = dates[0];
  const compactLabels = dates.length <= 14;
  const contentWidth = Math.max(860, 132 + dates.length * (compactLabels ? 72 : 38));
  return (
    <div className="design-timeline">
      <div className="design-timeline-content" style={{ '--timeline-days': dates.length, minWidth: contentWidth } as React.CSSProperties}>
        <div className="design-timeline-header">
          <div className="design-timeline-person-head">人员</div>
          <div className="design-timeline-days">
            {dates.map((date, index) => (
              <div key={date.format('YYYY-MM-DD')} className={`design-timeline-day ${date.day() === 0 ? 'is-sunday' : ''} ${date.isSame(dayjs(), 'day') ? 'is-today' : ''}`}>
                <span>{compactLabels || index === 0 || date.date() === 1 ? date.format('MM/DD') : date.format('D')}</span>
                <small>{weekDayLabel(date.day())}</small>
              </div>
            ))}
          </div>
        </div>
        {employees.map((employee) => {
          const employeeRecords = records.filter((record) => record.employee_id === employee.id);
          const employeeWorkDays = employeeRecords.reduce((total, record) => total + (record.work_days ?? 0), 0);
          const lanes = assignLanes(employeeRecords);
          const laneCount = Math.max(1, ...lanes.map((item) => item.lane + 1));
          const height = Math.max(52, laneCount * 36 + 12);
          return (
            <div key={employee.id} className="design-timeline-row" style={{ minHeight: height }}>
              <div className="design-timeline-person" style={{ minHeight: height }}>
                <div className="design-timeline-person-summary">
                  <Typography.Text strong>{employee.name}</Typography.Text>
                  <Typography.Text type="secondary">
                    {employeeWorkDays > 0 ? `${formatWorkDays(employeeWorkDays)}人天 · ` : ''}{employeeRecords.length}条
                  </Typography.Text>
                </div>
                {canCreate ? <Button type="link" size="small" onClick={() => onCreate(employee.id)}>录入</Button> : null}
              </div>
              <div className="design-timeline-track" style={{ minHeight: height }}>
                <div className="design-timeline-grid">
                  {dates.map((date) => <div key={date.format('YYYY-MM-DD')} className={date.day() === 0 ? 'is-sunday' : ''} />)}
                </div>
                {lanes.map(({ record, lane }) => {
                  const clippedStart = dayjs(record.start_date).isBefore(start, 'day') ? start : dayjs(record.start_date);
                  const clippedEnd = dayjs(record.end_date).isAfter(dates[dates.length - 1], 'day') ? dates[dates.length - 1] : dayjs(record.end_date);
                  const left = clippedStart.diff(start, 'day') / dates.length * 100;
                  const width = (clippedEnd.diff(clippedStart, 'day') + 1) / dates.length * 100;
                  const label = `${record.work_content}${record.work_days ? ` · ${formatWorkDays(record.work_days)}人天` : ''}`;
                  return (
                    <Tooltip key={record.id} title={label}>
                      <button
                        type="button"
                        className="design-timeline-bar"
                        style={{ left: `calc(${left}% + 3px)`, width: `calc(${width}% - 6px)`, top: lane * 36 + 7 }}
                        onClick={() => onOpenRecord(record)}
                      >
                        <span>{record.work_content}</span>
                        {record.work_days ? <strong>{formatWorkDays(record.work_days)}人天</strong> : null}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecordDetails({ record }: { record: DesignWorkRecord }) {
  return (
    <Descriptions bordered size="small" column={1}>
      <Descriptions.Item label="人员">{record.employee_name}</Descriptions.Item>
      <Descriptions.Item label="日期">{record.start_date === record.end_date ? record.start_date : `${record.start_date} 至 ${record.end_date}`}</Descriptions.Item>
      <Descriptions.Item label="人天">{record.work_days ? `${formatWorkDays(record.work_days)} 人天` : '-'}</Descriptions.Item>
      <Descriptions.Item label="工作内容">{record.work_content}</Descriptions.Item>
      <Descriptions.Item label="关联项目">{record.project_case_name ?? '未关联'}</Descriptions.Item>
      <Descriptions.Item label="子项目">{record.case_items.map((item) => item.name).join('、') || '-'}</Descriptions.Item>
      <Descriptions.Item label="工作类型">{record.work_type_name ?? '-'}</Descriptions.Item>
    </Descriptions>
  );
}

function assignLanes(records: DesignWorkRecord[]) {
  const sorted = [...records].sort((left, right) => left.start_date.localeCompare(right.start_date) || left.end_date.localeCompare(right.end_date));
  const laneEnds: string[] = [];
  return sorted.map((record) => {
    let lane = laneEnds.findIndex((end) => end < record.start_date);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = record.end_date;
    return { record, lane };
  });
}

function thisWeekRange(anchor: Dayjs) {
  const start = anchor.startOf('day').subtract((anchor.day() + 6) % 7, 'day');
  return { start, end: start.add(6, 'day') };
}

function lastWeekRange(anchor: Dayjs) {
  const current = thisWeekRange(anchor);
  return { start: current.start.subtract(7, 'day'), end: current.end.subtract(7, 'day') };
}

function thisMonthRange(anchor: Dayjs) {
  return { start: anchor.startOf('month'), end: anchor.endOf('month') };
}

function rangeMatches(left: { start: Dayjs; end: Dayjs }, right: { start: Dayjs; end: Dayjs }) {
  return left.start.isSame(right.start, 'day') && left.end.isSame(right.end, 'day');
}

function eachDay(start: Dayjs, end: Dayjs) {
  const result: Dayjs[] = [];
  for (let current = start; !current.isAfter(end, 'day'); current = current.add(1, 'day')) result.push(current);
  return result;
}

function weekDayLabel(day: number) {
  return ['日', '一', '二', '三', '四', '五', '六'][day];
}

function formatWorkDays(value: number) {
  return Number(value).toFixed(1).replace(/\.0$/, '');
}

function recordMatchesKeyword(record: DesignWorkRecord, keyword: string) {
  return [
    record.work_content,
    record.employee_name,
    record.project_case_name,
    record.work_type_name,
    record.start_date,
    record.end_date,
    record.work_days,
    ...record.case_items.map((item) => item.name)
  ].some((value) => String(value ?? '').toLocaleLowerCase().includes(keyword));
}
