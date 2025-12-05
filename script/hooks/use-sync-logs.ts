import { useRef, useState, useCallback } from 'scripting'
import type { SyncLog } from '../types'

/**
 * 同步日志管理 Hook
 */
export const useSyncLogs = () => {
    const [logs, setLogs] = useState<SyncLog[]>([])
    const logsBufferRef = useRef<SyncLog[]>([])
    const lastUpdateRef = useRef(0)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // 刷新日志缓冲区
    const flushLogs = useCallback(() => {
        if (logsBufferRef.current.length === 0) return

        const newLogs = [...logsBufferRef.current]
        logsBufferRef.current = []
        lastUpdateRef.current = Date.now()

        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }

        setLogs(prev => [...newLogs.reverse(), ...prev].slice(0, 500))
    }, [])

    // 添加日志
    const addLog = useCallback((action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => {
        const now = new Date()
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`

        logsBufferRef.current.push({
            time: timeStr,
            action,
            path,
            status,
            message
        })

        const currentTime = Date.now()
        if (currentTime - lastUpdateRef.current > 200) {
            flushLogs()
        } else {
            if (!timerRef.current) {
                timerRef.current = setTimeout(flushLogs, 200)
            }
        }
    }, [flushLogs])

    // 清空日志
    const clearLogs = useCallback(() => {
        setLogs([])
    }, [])

    // 清理定时器（用于组件卸载）
    const cleanup = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current)
    }, [])

    return {
        logs,
        addLog,
        clearLogs,
        flushLogs,
        cleanup,
        timerRef
    }
}
