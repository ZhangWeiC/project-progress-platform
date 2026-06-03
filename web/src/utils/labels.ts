const STATUS_LABELS: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  open: '待处理',
  resolved: '已解决',
  closed: '已关闭',
  cancelled: '已取消',
  submitted: '已提交'
};

const STATUS_COLORS: Record<string, string> = {
  not_started: 'default',
  in_progress: 'blue',
  completed: 'green',
  open: 'red',
  resolved: 'green',
  closed: 'default',
  cancelled: 'default',
  submitted: 'blue'
};

export function statusLabel(status?: string | null) {
  if (!status) return '-';
  return STATUS_LABELS[status] ?? status;
}

export function statusColor(status?: string | null) {
  if (!status) return 'default';
  return STATUS_COLORS[status] ?? 'default';
}
