import type { FileChangeEvent } from '../types'
import type { Settings } from '../utils'

// 存储 SocketManager 和 SocketIOClient 引用
let manager: SocketManager | null = null
let socket: SocketIOClient | null = null

/**
 * Socket.IO 连接选项
 */
export type SocketConnectOptions = {
    serverUrl: string
    bookmark: string
    settings: Settings
    onMessage: (event: FileChangeEvent) => void
    addLog: (action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => void
    setConnected: (connected: boolean) => void
    setConnecting: (connecting: boolean) => void
    setErrorMessage: (message: string) => void
    setTargetPath: (path: string | null) => void
    targetPathRef: { current: string | null }
    socketRef: { current: SocketIOClient | null }
}

/**
 * 创建 Socket.IO 连接
 */
export const createSocketConnection = (options: SocketConnectOptions): void => {
    const {
        serverUrl, bookmark, settings, onMessage, addLog,
        setConnected, setConnecting, setErrorMessage, setTargetPath,
        targetPathRef, socketRef
    } = options

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

    // 断开旧连接
    if (manager) {
        manager.disconnect()
        manager = null
    }

    setConnected(false)
    setConnecting(true)
    setErrorMessage('')
    setTargetPath(bookmarkedPath)
    targetPathRef.current = bookmarkedPath

    try {
        // 创建 SocketManager
        manager = new SocketManager(serverUrl, {
            forceWebsockets: true,
            reconnects: true,
            reconnectAttempts: 3,
            reconnectWait: 1,
            reconnectWaitMax: 5
        })

        socket = manager.defaultSocket
        socketRef.current = socket

        socket.on('connect', (data: any[]) => {
            setConnected(true)
            setConnecting(false)
            addLog('连接', '成功', 'success', '已连接到服务器')

            // 发送配置
            socket?.emit('configure', {
                enableFileSizeLimit: settings.enableFileSizeLimit,
                maxFileSize: settings.maxFileSize,
                pathRegex: settings.pathRegex
            })
        })

        socket.on('disconnect', (data: any[]) => {
            setConnected(false)
            setConnecting(false)
            addLog('断开', '服务器', 'warning', '连接已断开')
        })

        socket.on('statusChange', (data: any[]) => {
            const status = data[0] as string

            if (status === 'connected') {
                setConnected(true)
                setConnecting(false)
            } else if (status === 'connecting') {
                setConnecting(true)
                setConnected(false)
            } else if (status === 'disconnected' || status === 'notConnected') {
                setConnected(false)
                setConnecting(false)
            }
        })

        // 监听错误
        socket.on('error', (data: any[]) => {
            const error = Array.isArray(data) ? data[0] : data
            console.error('[Socket.IO] 错误:', error)
            const errorMsg = `连接错误: ${error?.message || error || '未知错误'}`
            setErrorMessage(errorMsg)
            addLog('连接', '错误', 'error', errorMsg)
        })

        // 监听连接被拒绝
        socket.on('connection_rejected', (data: any[]) => {
            const error = Array.isArray(data) ? data[0] : data
            console.error('[Socket.IO] 连接被拒绝:', error)
            const errorMsg = error?.message || '连接被服务端拒绝'
            setErrorMessage(errorMsg)
            setConnecting(false)
            addLog('连接', '拒绝', 'error', errorMsg)
        })

        // 监听各种事件并转发到 onMessage
        const events = [
            'update', 'delete', 'create_dir',
            'chunk_start', 'chunk_data', 'chunk_complete', 'chunk_ack',
            'sync_start', 'sync_complete', 'sync_error',
            'server_log'
        ]

        events.forEach(event => {
            socket?.on(event, (data: any[], ack: (value?: any) => void) => {
                const logData = Array.isArray(data) ? (data[0] || {}) : (data || {})

                const eventData = Array.isArray(data) ? (data[0] || {}) : (data || {})
                onMessage({ ...eventData, action: event } as FileChangeEvent)
            })
        })

        // 连接
        socket.connect()
        addLog('连接', '开始', 'success', '正在连接服务器...')

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
export const disconnectSocket = (
    socketRef: { current: SocketIOClient | null },
    addLog: (action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => void
): void => {
    if (manager) {
        manager.disconnect()
        manager = null
        socket = null
        socketRef.current = null
        addLog('断开', '手动', 'success', '用户主动断开连接')
    }
}

/**
 * 取消连接
 */
export const cancelSocketConnect = (
    socketRef: { current: SocketIOClient | null },
    setConnecting: (connecting: boolean) => void,
    setConnected: (connected: boolean) => void,
    addLog: (action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => void
): void => {
    if (manager) {
        manager.disconnect()
        manager = null
        socket = null
        socketRef.current = null
    }
    setConnecting(false)
    setConnected(false)
    addLog('取消连接', '', 'warning', '用户取消连接')
}

/**
 * 请求下载全部
 */
export const requestSyncAll = (
    socketRef: { current: SocketIOClient | null },
    connected: boolean,
    setErrorMessage: (message: string) => void,
    addLog: (action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => void
): void => {
    if (!socketRef.current || !connected) {
        setErrorMessage('请先连接到服务器')
        return
    }
    try {
        socketRef.current.emit('sync_all', {})
        addLog('请求', '下载全部', 'success', '已发送下载全部请求')
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        setErrorMessage(`请求失败: ${errorMsg}`)
    }
}

/**
 * 获取当前 socket
 */
export const getSocket = (): SocketIOClient | null => socket
