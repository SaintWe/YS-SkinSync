import { createStorageManager } from './storage'

// 储存键名 - 统一管理所有持久化数据
const STORAGE_NAME = 'SaintW.skinSync.Settings'

// 创建存储管理器实例
const storageManager = createStorageManager(STORAGE_NAME)

export type Settings = {
  bookmark: string,
  wsUrl: string,
  customButtonTitle: string,
  customButtonUrl: string,
  pathRegex: string[],
  enableFileSizeLimit: boolean,
  maxFileSize: number,
  autoConnect: boolean,
}

/**
 * 默认设置
 */
const DEFAULT_SETTINGS: Settings = {
  bookmark: '',
  wsUrl: 'ws://10.0.0.15:10080',
  customButtonTitle: '前往元书',
  customButtonUrl: String.raw`hamster3://com.ihsiao.apps.hamster3/keyboardSkins`,
  pathRegex: [
    String.raw`\.DS_Store$`,
    String.raw`__MACOSX$`,
    String.raw`^fonts/?`,
    String.raw`\.gitignore$`,
  ],
  enableFileSizeLimit: false,
  // 默认250kb，单位字节
  maxFileSize: 250 * 1024,
  autoConnect: false,
}

// 存储键 - 用于访问统一存储对象中的具体字段
export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  CACHE_DATA: 'cacheData',
  LAST_UPDATE: 'lastUpdate',
  LAST_VERSION: 'lastVersion',
}

/**
 * 获取当前设置
 */
export const getCurrentSettings = () => {
  try {
    const savedSettings = storageManager.storage.get<Settings>(STORAGE_KEYS.SETTINGS)
    if (savedSettings) {
      return { ...DEFAULT_SETTINGS, ...savedSettings }
    }
  } catch (error) {
    console.error('读取设置失败:', error)
  }
  return DEFAULT_SETTINGS
}

/**
 * 保存设置
 */
export const saveSettings = (settings: Settings) => {
  try {
    storageManager.storage.set(STORAGE_KEYS.SETTINGS, settings)
    return true
  } catch (error) {
    console.error('保存设置失败:', error)
    return false
  }
}


/**
 * 解析URL参数的简单函数
 * @param url URL字符串
 * @returns 参数对象
 */
const parseUrlParams = (url: string): Record<string, string> => {
  const params: Record<string, string> = {}
  const queryString = url.split('?')[1]
  if (queryString) {
    const pairs = queryString.split('&')
    for (const pair of pairs) {
      const [key, value] = pair.split('=')
      if (key && value) {
        params[decodeURIComponent(key)] = decodeURIComponent(value)
      }
    }
  }
  return params
}
