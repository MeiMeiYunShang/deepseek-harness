/** Locale bundles for the model price table page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the page renders. */
export type ConsolePricingLocaleKey =
  | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed'
  | 'title' | 'summary' | 'intro' | 'unit' | 'empty'
  | 'addRow' | 'removeRow'
  | 'baseUrl' | 'provider' | 'model' | 'peak' | 'offPeak'
  | 'cacheHit' | 'cacheMiss' | 'output'
  | 'invalidBaseUrl' | 'invalidProvider' | 'invalidModel' | 'invalidPrice' | 'invalidDuplicate'
  | 'conflicted'

/** English copy. */
export const en: Record<ConsolePricingLocaleKey, string> = {
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept this table; it was left for you to correct.',
  title: 'Model prices',
  summary: 'What each model route costs per million tokens.',
  intro: 'One row per endpoint, provider, and model. Both bands are charged per million tokens, and a route with no row is reported as unpriced.',
  unit: 'Currency units per million tokens.',
  empty: 'No prices recorded. Every route is reported as unpriced until a row covers it.',
  addRow: 'Add model route',
  removeRow: 'Remove model route',
  baseUrl: 'Endpoint',
  provider: 'Provider',
  model: 'Model',
  peak: 'Peak',
  offPeak: 'Off-peak',
  cacheHit: 'Cache-hit input',
  cacheMiss: 'Cache-miss input',
  output: 'Output',
  invalidBaseUrl: 'Enter the endpoint this route is reached through.',
  invalidProvider: 'Enter the provider id, spelled as the model catalog spells it.',
  invalidModel: 'Enter the model id, spelled as the model catalog spells it.',
  invalidPrice: 'Enter a rate of 0 or more for every token type in both bands.',
  invalidDuplicate: 'Another row already uses this endpoint, provider, and model.',
  conflicted: 'Settings changed elsewhere. Discard this table and try again.',
}

/** Simplified Chinese copy. */
export const zh: Record<ConsolePricingLocaleKey, string> = {
  readOnly: '本部署的设置为只读',
  unavailable: '该插件当前未加载，暂时无法配置',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这张价格表，已保留供你修改',
  title: '模型价格',
  summary: '每条模型路由每百万 token 的价格',
  intro: '每行一条路由，由接入地址、提供方和模型确定。两个时段都按每百万 token 计价，没有对应行的路由会显示为未定价。',
  unit: '货币单位／百万 token',
  empty: '尚未记录价格。在添加对应行之前，所有路由都显示为未定价',
  addRow: '添加模型路由',
  removeRow: '删除模型路由',
  baseUrl: '接入地址',
  provider: '提供方',
  model: '模型',
  peak: '高峰',
  offPeak: '低谷',
  cacheHit: '缓存命中输入',
  cacheMiss: '缓存未命中输入',
  output: '输出',
  invalidBaseUrl: '请填写该路由的接入地址',
  invalidProvider: '请填写提供方标识，与模型目录一致',
  invalidModel: '请填写模型标识，与模型目录一致',
  invalidPrice: '请为两个时段的每类 token 填写不小于 0 的价格',
  invalidDuplicate: '已有一行使用相同的接入地址、提供方和模型',
  conflicted: '设置已在其他位置更新，请放弃这张表后重试',
}

/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: ConsolePricingLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
