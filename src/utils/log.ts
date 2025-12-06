// 日志前缀
const LOG_PREFIX = '[F11eSync]'

/**
 * 统一日志输出
 */
export const log = (...args: unknown[]) => console.log(LOG_PREFIX, ...args)
export const warn = (...args: unknown[]) => console.warn(LOG_PREFIX, ...args)
export const error = (...args: unknown[]) => console.error(LOG_PREFIX, ...args)

/**
 * 分片进度日志（每20%或最后一片输出）
 * @param current 当前分片索引（从0开始）或已完成数量
 * @param total 总分片数
 * @param action 动作描述（如"发送分片"、"接收分片"）
 * @param isZeroIndexed 是否是0索引（发送用0索引，接收用1索引）
 */
export const logChunkProgress = (
    current: number,
    total: number,
    action: string,
    isZeroIndexed = true
): void => {
    const completed = isZeroIndexed ? current + 1 : current
    const prev = isZeroIndexed ? current : current - 1
    const progress = Math.floor((completed / total) * 5)
    const prevProgress = Math.floor((prev / total) * 5)
    const isLast = isZeroIndexed ? current === total - 1 : current === total

    if (progress > prevProgress || isLast) {
        log(`${action}: ${completed}/${total} (${Math.round((completed / total) * 100)}%)`)
    }
}
