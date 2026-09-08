/** Console workbench dictionary namespace and its key union. */

/** The console dictionary keys. */
export type ConsoleKey = 'console'
  | 'title'
  | 'close'
  | 'trigger'
  | 'layout'
  | 'layoutAria'
  | 'layout.balanced'
  | 'layout.timeline'
  | 'layout.compact'
  | 'collapse'
  | 'expand'
  | 'newSession'
  | 'sessionStatus'
  | 'sessionViewToggleAria'
  | 'sessionStatsView'
  | 'sessionGridView'
  | 'sessionTotal'
  | 'sessionRunning'
  | 'sessionPending'
  | 'sessionCompleted'
  | 'sessionArchived'
  | 'sessionCurrent'
  | 'taskStats'
  | 'taskAllSessions'
  | 'taskScope'
  | 'taskRunning'
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
  | 'timelineScopeAll'
  | 'timelineClear'
  | 'timelineStatus'
  | 'timelineActivity'
  | 'timelineModeAria'
  | 'timelineEmpty'
  | 'timelineExpand'
  | 'timelineCollapse'
  | 'sessionPrefix'
  | 'knowledge'
  | 'knowledgeEmpty'
  | 'knowledgeLatest'
  | 'smartQA'
  | 'qaEmpty'
  | 'qaThinking'
  | 'inputPlaceholder'
  | 'composerPlaceholder'
  | 'composerDisabled'
  | 'composerError'
  | 'send'
  | 'stop'
  | 'qaError'
  | 'rename'
  | 'renameTitle'
  | 'renameInputAria'
  | 'renameConfirm'
  | 'renameCancel'
  | 'fork'
  | 'archive'
  | 'archiveConfirmTitle'
  | 'archiveConfirmBody'
  | 'confirm'
  | 'cancel'
  | 'contextMenuAria'
  | 'newSessionTitle'
  | 'workspaceLabel'
  | 'addWorkspace'
  | 'presetLabel'
  | 'presetNone'
  | 'instructionLabel'
  | 'instructionPlaceholder'
  | 'sessionGridAria'
  | 'sessionGridSelected'
  | 'sessionGridCurrent'
  | 'sessionGridUpdated'
  | 'sessionGridCwd'
  | 'sessionStatus.running'
  | 'sessionStatus.planning'
  | 'sessionStatus.pending'
  | 'sessionStatus.waiting'
  | 'sessionStatus.available'
  | 'sessionStatus.archived'
  | 'na'
  | 'selectedSession'
  | 'noSession'
  | 'updatedAt'
  | 'askUserTitle'
  | 'askUserRecommend'
  | 'askUserSelfInput'
  | 'askUserSkip'
  | 'askUserBack'
  | 'askUserNext'
  | 'askUserSubmit'
  | 'askUserCancel'

/** Dictionary namespace owned by this plugin. */
export const NS = 'console'

/** English dictionary for the console namespace. */
export const en: Record<ConsoleKey, string> = {
  console: 'Console',
  title: 'Console',
  close: 'Close',
  trigger: 'Console',
  layout: 'Layout',
  layoutAria: 'Column layout',
  'layout.balanced': 'Balanced',
  'layout.timeline': 'Focus',
  'layout.compact': 'Compact',
  collapse: 'Collapse',
  expand: 'Expand',
  newSession: 'New session',
  sessionStatus: 'Session status',
  sessionViewToggleAria: 'Session view',
  sessionStatsView: 'Stats',
  sessionGridView: 'Grid',
  sessionTotal: 'Total',
  sessionRunning: 'Running',
  sessionPending: 'Awaiting input',
  sessionCompleted: 'Completed',
  sessionArchived: 'Archived',
  sessionCurrent: 'current',
  taskStats: 'Task statistics',
  taskAllSessions: 'All sessions',
  taskScope: 'Scope',
  taskRunning: 'Running now',
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
  timelineScopeAll: 'All sessions',
  timelineClear: 'Clear',
  timelineStatus: 'Status',
  timelineActivity: 'Activity',
  timelineModeAria: 'Timeline mode',
  timelineEmpty: 'No session activity yet.',
  timelineExpand: 'Expand',
  timelineCollapse: 'Collapse',
  sessionPrefix: 'Session',
  knowledge: 'Knowledge base',
  knowledgeEmpty: 'No knowledge sources yet.',
  knowledgeLatest: 'Latest',
  smartQA: 'Smart Q&A',
  qaEmpty: 'Ask a question to start.',
  qaThinking: 'Thinking…',
  inputPlaceholder: 'Ask about the sessions',
  composerPlaceholder: 'Send an instruction to the session…',
  composerDisabled: 'Select a session to send instructions',
  composerError: 'Instruction failed',
  send: 'Send',
  stop: 'Stop',
  qaError: 'Request failed',
  rename: 'Rename',
  renameTitle: 'Rename session',
  renameInputAria: 'Session title',
  renameConfirm: 'Rename',
  renameCancel: 'Cancel',
  fork: 'Fork',
  archive: 'Archive',
  archiveConfirmTitle: 'Archive session',
  archiveConfirmBody: 'Archive this session? Its history is kept but it is removed from the active list.',
  confirm: 'Confirm',
  cancel: 'Cancel',
  contextMenuAria: 'Session actions',
  newSessionTitle: 'New session',
  workspaceLabel: 'Workspace',
  addWorkspace: 'Add workspace…',
  presetLabel: 'Preset',
  presetNone: 'None',
  instructionLabel: 'First instruction',
  instructionPlaceholder: 'Type the first instruction…',
  sessionGridAria: 'Sessions',
  sessionGridSelected: 'Selected',
  sessionGridCurrent: 'Current',
  sessionGridUpdated: 'Updated',
  sessionGridCwd: 'cwd',
  'sessionStatus.running': 'Running',
  'sessionStatus.planning': 'Planning',
  'sessionStatus.pending': 'Pending',
  'sessionStatus.waiting': 'Waiting',
  'sessionStatus.available': 'Available',
  'sessionStatus.archived': 'Archived',
  na: 'N/A',
  selectedSession: 'selected',
  noSession: 'No session selected',
  updatedAt: 'updated',
  askUserTitle: 'Question',
  askUserRecommend: 'Recommended',
  askUserSelfInput: 'Type your own answer',
  askUserSkip: 'Skip',
  askUserBack: 'Previous',
  askUserNext: 'Next',
  askUserSubmit: 'Submit',
  askUserCancel: 'Cancel',
}

/** Chinese dictionary for the console namespace. */
export const zh: Record<ConsoleKey, string> = {
  console: '控制台',
  title: '控制台',
  close: '关闭',
  trigger: '控制台',
  layout: '布局',
  layoutAria: '列布局',
  'layout.balanced': '均衡',
  'layout.timeline': '聚焦',
  'layout.compact': '紧凑',
  collapse: '折叠',
  expand: '展开',
  newSession: '新建会话',
  sessionStatus: '会话状态',
  sessionViewToggleAria: '会话视图',
  sessionStatsView: '统计',
  sessionGridView: '网格',
  sessionTotal: '总数',
  sessionRunning: '运行中',
  sessionPending: '等待输入',
  sessionCompleted: '已完成',
  sessionArchived: '已归档',
  sessionCurrent: '当前',
  taskStats: '任务统计',
  taskAllSessions: '全部会话',
  taskScope: '作用域',
  taskRunning: '运行中',
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
  timelineScopeAll: '全部会话',
  timelineClear: '清除',
  timelineStatus: '状态',
  timelineActivity: '活动',
  timelineModeAria: '时间线模式',
  timelineEmpty: '暂无会话活动。',
  timelineExpand: '展开',
  timelineCollapse: '收起',
  sessionPrefix: '会话',
  knowledge: '知识库',
  knowledgeEmpty: '暂无知识来源。',
  knowledgeLatest: '最新',
  smartQA: '智能问答',
  qaEmpty: '输入问题开始。',
  qaThinking: '思考中…',
  inputPlaceholder: '询问会话相关内容',
  composerPlaceholder: '向会话发送指令…',
  composerDisabled: '请选择会话后再发送指令',
  composerError: '指令发送失败',
  send: '发送',
  stop: '停止',
  qaError: '请求失败',
  rename: '重命名',
  renameTitle: '重命名会话',
  renameInputAria: '会话标题',
  renameConfirm: '重命名',
  renameCancel: '取消',
  fork: 'Fork',
  archive: '归档',
  archiveConfirmTitle: '归档会话',
  archiveConfirmBody: '要归档这个会话吗？历史会保留，但会从活动列表中移除。',
  confirm: '确认',
  cancel: '取消',
  contextMenuAria: '会话操作',
  newSessionTitle: '新建会话',
  workspaceLabel: '工作区',
  addWorkspace: '添加工作区…',
  presetLabel: '预设',
  presetNone: '无',
  instructionLabel: '首条指令',
  instructionPlaceholder: '输入首条指令…',
  sessionGridAria: '会话',
  sessionGridSelected: '已选',
  sessionGridCurrent: '当前',
  sessionGridUpdated: '更新于',
  sessionGridCwd: 'cwd',
  'sessionStatus.running': '运行中',
  'sessionStatus.planning': '规划中',
  'sessionStatus.pending': '等待输入',
  'sessionStatus.waiting': '等待中',
  'sessionStatus.available': '可用',
  'sessionStatus.archived': '已归档',
  na: 'N/A',
  selectedSession: '已选',
  noSession: '未选择会话',
  updatedAt: '更新于',
  askUserTitle: '问题',
  askUserRecommend: '推荐',
  askUserSelfInput: '输入自定义答案',
  askUserSkip: '跳过',
  askUserBack: '上一条',
  askUserNext: '下一条',
  askUserSubmit: '提交',
  askUserCancel: '取消',
}
