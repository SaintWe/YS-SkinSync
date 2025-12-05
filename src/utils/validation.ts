import type { ClientConfig, ValidationResult } from '../types'
import { shouldFilterPath } from './path'

/**
 * 验证文件大小
 */
export function validateFileSize(size: number, config: ClientConfig): ValidationResult {
    if (config.enableFileSizeLimit && config.maxFileSize && size > config.maxFileSize) {
        return { valid: false, reason: `文件过大 (${(size / 1024).toFixed(1)}KB)，已跳过` }
    }
    return { valid: true }
}

/**
 * 验证路径过滤规则
 */
export function validatePath(path: string, config: ClientConfig): ValidationResult {
    if (shouldFilterPath(path, config)) {
        return { valid: false, reason: '匹配过滤规则，已跳过' }
    }
    return { valid: true }
}
