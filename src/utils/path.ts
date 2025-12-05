import type { ClientConfig } from '../types'

/**
 * 转 Unix 风格路径
 */
export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/')
}

/**
 * 检查路径是否应被过滤
 */
export function shouldFilterPath(path: string, config: ClientConfig): boolean {
    if (!config.pathRegex || config.pathRegex.length === 0) return false
    const normalizedPath = normalizePath(path)
    for (const regexStr of config.pathRegex) {
        try {
            const regex = new RegExp(regexStr)
            if (regex.test(normalizedPath)) {
                return true
            }
        } catch {
            // 忽略无效正则
        }
    }
    return false
}
