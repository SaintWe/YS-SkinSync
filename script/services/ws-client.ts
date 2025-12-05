import type { FileChangeEvent } from '../types'
import type { Settings } from '../utils'

/**
 * WebSocket 连接选项
 */
export type WSConnectOptions = {
    wsUrl: string
    bookmark: string
    settings: Settings
    onMessage: (event: FileChangeEvent) => void
    addLog: (action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => void
    setConnected: (connected: boolean) => void
    setConnecting: (connecting: boolean) => void
    setErrorMessage: (message: string) => void
    setTargetPath: (path: string | null) => void
    targetPathRef: { current: string | null }
    wsRef: { current: WebSocket | null }
    connectTimeoutRef: { current: ReturnType<typeof setTimeout> | null }
    timerRef: { current: ReturnType<typeof setTimeout> | null }
}

/**
 * 创建 WebSocket 连接
 */
export const createWSConnection = (options: WSConnectOptions): void => {
    const {
        wsUrl, bookmark, settings, onMessage, addLog,
        setConnected, setConnecting, setErrorMessage, setTargetPath,
        targetPathRef, wsRef, connectTimeoutRef, timerRef
    } = options

    // 清理旧连接
    if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
    }

    // 检查文件书签
    if (!FileManager.bookmarkExists(bookmark)) {
        setErrorMessage(`文件书签 "${bookmark}" 不存在`)
        return
    }

    const bookmarkedPath = FileManager.bookmarkedPath(bookmark)
    if (!bookmarkedPath) {
        setErrorMessage('无法获取书签路径')
        return
    }

    setConnected(false)
    setConnecting(true)
    setErrorMessage('')
    setTargetPath(bookmarkedPath)
    targetPathRef.current = bookmarkedPath

    try {
        const ws = new WebSocket(wsUrl)
        let isHandshakeHandled = false
        let isConnectionEstablished = false

        // 连接超时
        connectTimeoutRef.current = setTimeout(() => {
            if (!isHandshakeHandled) {
                isHandshakeHandled = true
                ws.close()
                if (wsRef.current === ws) wsRef.current = null
                setConnecting(false)
                setConnected(false)
                setErrorMessage('连接超时，请检查服务器是否启动')
                addLog('连接', '超时', 'error', '连接超时（10秒）')
            }
        }, 10000)

        ws.onerror = (error) => {
            if (isHandshakeHandled) return
            isHandshakeHandled = true
            isConnectionEstablished = false

            if (connectTimeoutRef.current) {
                clearTimeout(connectTimeoutRef.current)
                connectTimeoutRef.current = null
            }

            const errorMsg = `连接错误: ${error || '未知错误'}`
            setErrorMessage(errorMsg)
            setConnecting(false)
            setConnected(false)
            if (wsRef.current === ws) wsRef.current = null
            addLog('连接', '错误', 'error', errorMsg)
        }

        ws.onopen = () => {
            setTimeout(() => {
                if (isHandshakeHandled) return
                isHandshakeHandled = true
                isConnectionEstablished = true

                setConnected(true)
                setConnecting(false)
                if (connectTimeoutRef.current) {
                    clearTimeout(connectTimeoutRef.current)
                    connectTimeoutRef.current = null
                }
                if (timerRef.current) clearTimeout(timerRef.current)
                addLog('连接', '成功', 'success', '已连接到服务器')

                // 发送配置
                ws.send(JSON.stringify({
                    action: 'configure',
                    config: {
                        enableFileSizeLimit: settings.enableFileSizeLimit,
                        maxFileSize: settings.maxFileSize,
                        pathRegex: settings.pathRegex
                    }
                }))
            }, 10)
        }

        ws.onmessage = (message) => {
            try {
                const data = typeof message === 'string' ? JSON.parse(message) : JSON.parse(message.toString())
                onMessage(data as FileChangeEvent)
            } catch (error) {
                console.error('消息处理失败:', error)
                addLog('消息解析', '', 'error', '无法解析服务器消息')
            }
        }

        ws.onclose = (event) => {
            if (connectTimeoutRef.current) {
                clearTimeout(connectTimeoutRef.current)
                connectTimeoutRef.current = null
            }

            if (isHandshakeHandled && !isConnectionEstablished) {
                if (wsRef.current === ws) wsRef.current = null
                return
            }

            isHandshakeHandled = true
            isConnectionEstablished = false
            setConnected(false)
            setConnecting(false)

            const isManual = wsRef.current === null
            if (wsRef.current === ws) wsRef.current = null

            let message = '连接已关闭'
            if (isManual) {
                message = '已断开连接'
            } else if (event && typeof event === 'object') {
                // @ts-ignore
                message = event.reason || '服务器断开连接'
            }

            addLog('断开', '服务器', 'warning', message)
        }

        wsRef.current = ws
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        setErrorMessage(`连接失败: ${errorMsg}`)
        setConnecting(false)
        addLog('连接', '失败', 'error', errorMsg)
    }
}

/**
 * 断开连接
 */
export const disconnectWS = (
    wsRef: { current: WebSocket | null },
    addLog: (action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => void
): void => {
    if (wsRef.current) {
        const ws = wsRef.current
        wsRef.current = null
        ws.close()
        addLog('断开', '手动', 'success', '用户主动断开连接')
    }
}

/**
 * 取消连接
 */
export const cancelWSConnect = (
    wsRef: { current: WebSocket | null },
    connectTimeoutRef: { current: ReturnType<typeof setTimeout> | null },
    setConnecting: (connecting: boolean) => void,
    setConnected: (connected: boolean) => void,
    addLog: (action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => void
): void => {
    if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
    }
    if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
    }
    setConnecting(false)
    setConnected(false)
    addLog('取消连接', '', 'warning', '用户取消连接')
}

/**
 * 请求下载全部
 */
export const requestSyncAll = (
    wsRef: { current: WebSocket | null },
    connected: boolean,
    setErrorMessage: (message: string) => void,
    addLog: (action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => void
): void => {
    if (!wsRef.current || !connected) {
        setErrorMessage('请先连接到服务器')
        return
    }
    try {
        wsRef.current.send(JSON.stringify({ action: 'sync_all' }))
        addLog('请求', '下载全部', 'success', '已发送下载全部请求')
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        setErrorMessage(`请求失败: ${errorMsg}`)
    }
}
