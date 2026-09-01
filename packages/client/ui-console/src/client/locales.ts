/** Console workbench dictionary namespace and its key union. */

/** The console dictionary keys. */
export type ConsoleKey = 'console'
  | 'title'
  | 'close'
  | 'trigger'
  | 'sessionStatus'
  | 'sessionTotal'
  | 'sessionRunning'
  | 'sessionPending'
  | 'sessionCompleted'
  | 'sessionArchived'
  | 'currentSession'
  | 'taskStats'
  | 'taskTurns'
  | 'taskSteps'
  | 'taskLlmMs'
  | 'taskToolMs'
  | 'systemStatus'
  | 'cpu'
  | 'ram'
  | 'gpu'
  | 'pendingInteractions'
  | 'pendingQuestion'
  | 'pendingPlanReview'
  | 'noPending'
  | 'timeline'
  | 'timelineEmpty'
  | 'timelineActivity'
  | 'timelineStatus'
  | 'timelineModeAria'
  | 'sessionPrefix'
  | 'na'
  | 'pageSelection'
  | 'selectedSession'
  | 'noSession'
  | 'comingSoon'
  | 'smartQA'
  | 'qaEmpty'
  | 'qaThinking'
  | 'inputPlaceholder'
  | 'send'
  | 'stop'
  | 'qaError'

/** Dictionary namespace owned by this plugin. */
export const NS = 'console'

/** English dictionary for the console namespace. */
export const en: Record<ConsoleKey, string> = {
  console: 'Console',
  title: 'Console',
  close: 'Close',
  trigger: 'Console',
  sessionStatus: 'Session status',
  sessionTotal: 'Total',
  sessionRunning: 'Running',
  sessionPending: 'Awaiting input',
  sessionCompleted: 'Completed',
  sessionArchived: 'Archived',
  currentSession: 'current',
  taskStats: 'Task statistics',
  taskTurns: 'Turns',
  taskSteps: 'Steps',
  taskLlmMs: 'LLM time',
  taskToolMs: 'Tool time',
  systemStatus: 'System status',
  cpu: 'CPU',
  ram: 'Memory',
  gpu: 'GPU',
  pendingInteractions: 'Pending interactions',
  pendingQuestion: 'Question',
  pendingPlanReview: 'Plan review',
  noPending: 'None',
  timeline: 'Timeline',
  timelineEmpty: 'No session activity yet.',
  timelineActivity: 'activity',
  timelineStatus: 'status',
  timelineModeAria: 'Timeline mode',
  sessionPrefix: 'Session',
  na: 'N/A',
  pageSelection: 'Page',
  selectedSession: 'selected',
  noSession: 'No session selected',
  comingSoon: 'Coming soon',
  smartQA: 'Smart Q&A',
  qaEmpty: 'Ask a question to start.',
  qaThinking: 'Thinking…',
  inputPlaceholder: 'Ask about the sessions',
  send: 'Send',
  stop: 'Stop',
  qaError: 'Request failed',
}

/** Chinese dictionary for the console namespace. */
export const zh: Record<ConsoleKey, string> = {
  console: '控制台',
  title: '控制台',
  close: '关闭',
  trigger: '控制台',
  sessionStatus: '会话状态',
  sessionTotal: '总数',
  sessionRunning: '运行中',
  sessionPending: '等待输入',
  sessionCompleted: '已完成',
  sessionArchived: '已归档',
  currentSession: '当前',
  taskStats: '任务统计',
  taskTurns: '轮数',
  taskSteps: '步骤数',
  taskLlmMs: 'LLM 耗时',
  taskToolMs: '工具耗时',
  systemStatus: '系统状态',
  cpu: 'CPU',
  ram: '内存',
  gpu: 'GPU',
  pendingInteractions: '待处理交互',
  pendingQuestion: '提问',
  pendingPlanReview: '计划审阅',
  noPending: '无',
  timeline: '时间线',
  timelineEmpty: '暂无会话活动。',
  timelineActivity: '活动',
  timelineStatus: '状态',
  timelineModeAria: '时间线模式',
  sessionPrefix: '会话',
  na: 'N/A',
  pageSelection: '页面',
  selectedSession: '已选',
  noSession: '未选择会话',
  comingSoon: '即将推出',
  smartQA: '智能问答',
  qaEmpty: '输入问题开始。',
  qaThinking: '思考中…',
  inputPlaceholder: '询问会话相关内容',
  send: '发送',
  stop: '停止',
  qaError: '请求失败',
}
