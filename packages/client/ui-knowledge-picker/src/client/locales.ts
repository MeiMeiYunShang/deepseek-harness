/** `knowledgePicker` namespace dictionaries for the hero chip and composer toggler. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'knowledgePicker'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  chip: '知识',
  chipCount: '已选 {count} 条',
  chipEmpty: '无条目',
  composerToggler: '知识',
  dialogTitle: '选择知识',
  search: '搜索条目…',
  confirm: '确认',
  cancel: '取消',
  empty: '暂无可用知识条目。',
  selected: '已选 {count} 条',
} satisfies Record<string, string>

/** The knowledge picker namespace key union. */
export type KnowledgePickerKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  chip: 'Knowledge',
  chipCount: '{count} selected',
  chipEmpty: 'No entries',
  composerToggler: 'Knowledge',
  dialogTitle: 'Select knowledge',
  search: 'Search entries…',
  confirm: 'Confirm',
  cancel: 'Cancel',
  empty: 'No knowledge entries are available.',
  selected: '{count} selected',
} satisfies Record<KnowledgePickerKey, string>
