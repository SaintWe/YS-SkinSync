/**
 * Intent 处理器 - 支持 iOS 快捷指令调用
 * 
 * 支持的操作:
 * - sync_all: 连接服务器并下载全部文件
 * - upload_all: 连接服务器并上传全部文件
 * 
 * 使用方式:
 * 在快捷指令中传递 JSON 参数: {"action": "sync_all"} 或 {"action": "upload_all"}
 */

import { Intent, Script } from 'scripting'
import { getCurrentSettings, type Settings } from './utils/skinSync-service'
import { handleFileSync } from './services/file-sync'
import type { FileChangeEvent, ChunkReceiveState, ChunkAckWaiter } from './types'

// 存储引用
let manager: SocketManager | null = null
let socket: SocketIOClient | null = null

// 状态
let connected = false
let syncing = false
let uploading = false
let completed = false
let errorMsg = ''

// Refs
const socketRef = { current: socket }
const targetPathRef: { current: string | null } = { current: null }
const uploadingRef = { current: false }
const chunkReceiveStateRef = { current: new Map<string, ChunkReceiveState>() }
const chunkAckWaitersRef = { current: new Map<string, ChunkAckWaiter>() }

// 日志收集
const logs: string[] = []

/**
 * 添加日志
 */
const addLog = (action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => {
    const log = `[${status}] ${action}: ${path}${message ? ` - ${message}` : ''}`
    logs.push(log)
    console.log(log)
}

/**
 * 创建连接
 */
const createConnection = (settings: Settings): Promise<boolean> => {
    return new Promise((resolve) => {
        const { bookmark, serverUrl } = settings

        // 检查文件书签
        if (!FileManager.bookmarkExists(bookmark)) {
            errorMsg = `文件书签 "${bookmark}" 不存在`
            resolve(false)
            return
        }

        const bookmarkedPath = FileManager.bookmarkedPath(bookmark)
        if (!bookmarkedPath) {
            errorMsg = '无法获取书签路径'
            resolve(false)
            return
        }

        targetPathRef.current = bookmarkedPath

        try {
            manager = new SocketManager(serverUrl, {
                forceWebsockets: true,
                reconnects: false
            })

            socket = manager.defaultSocket
            socketRef.current = socket

            let resolved = false

            // 连接超时
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true
                    errorMsg = '连接超时'
                    manager?.disconnect()
                    resolve(false)
                }
            }, 15000)

            socket.on('connect', () => {
                if (!resolved) {
                    resolved = true
                    clearTimeout(timeout)
                    connected = true
                    addLog('连接', '成功', 'success', '已连接到服务器')

                    // 发送配置
                    socket?.emit('configure', {
                        enableFileSizeLimit: settings.enableFileSizeLimit,
                        maxFileSize: settings.maxFileSize,
                        pathRegex: settings.pathRegex
                    })

                    resolve(true)
                }
            })

            socket.on('error', (data: any[]) => {
                if (!resolved) {
                    resolved = true
                    clearTimeout(timeout)
                    const error = Array.isArray(data) ? data[0] : data
                    errorMsg = `连接错误: ${error?.message || error || '未知错误'}`
                    resolve(false)
                }
            })

            socket.on('connection_rejected', (data: any[]) => {
                if (!resolved) {
                    resolved = true
                    clearTimeout(timeout)
                    const error = Array.isArray(data) ? data[0] : data
                    errorMsg = error?.message || '连接被服务端拒绝'
                    resolve(false)
                }
            })

            // 监听文件同步事件
            const events = [
                'update', 'delete', 'create_dir',
                'chunk_start', 'chunk_data', 'chunk_complete', 'chunk_ack',
                'sync_start', 'sync_complete', 'sync_error',
                'server_log'
            ]

            events.forEach(event => {
                socket?.on(event, async (data: any[]) => {
                    const eventData = Array.isArray(data) ? (data[0] || {}) : (data || {})

                    // 处理同步完成
                    if (event === 'sync_complete') {
                        completed = true
                    }

                    await handleFileSync(
                        { ...eventData, action: event } as FileChangeEvent,
                        {
                            uploadingRef,
                            targetPathRef,
                            socketRef,
                            chunkReceiveStateRef,
                            chunkAckWaitersRef,
                            settings,
                            addLog,
                            setSyncing: (v) => { syncing = v },
                            setUploading: (v) => { uploading = v; uploadingRef.current = v }
                        }
                    )
                })
            })

            socket.connect()
            addLog('连接', '开始', 'success', '正在连接服务器...')

        } catch (error) {
            errorMsg = error instanceof Error ? error.message : String(error)
            resolve(false)
        }
    })
}

/**
 * 请求下载全部
 */
const requestSyncAll = (): void => {
    if (socket && connected) {
        socket.emit('sync_all', {})
        addLog('请求', '下载全部', 'success', '已发送下载全部请求')
    }
}

/**
 * 等待同步完成
 */
const waitForComplete = (timeout: number = 300000): Promise<boolean> => {
    return new Promise((resolve) => {
        const startTime = Date.now()

        const check = () => {
            if (completed) {
                resolve(true)
                return
            }

            if (Date.now() - startTime > timeout) {
                errorMsg = '同步超时'
                resolve(false)
                return
            }

            setTimeout(check, 500)
        }

        check()
    })
}

/**
 * 断开连接
 */
const disconnect = (): void => {
    if (manager) {
        manager.disconnect()
        manager = null
        socket = null
        socketRef.current = null
    }
}

/**
 * 主入口
 */
async function run() {
    try {
        // 获取快捷指令参数
        let action = 'sync_all' // 默认操作

        if (Intent.shortcutParameter) {
            if (Intent.shortcutParameter.type === 'text') {
                try {
                    const params = JSON.parse(Intent.shortcutParameter.value as string)
                    action = params.action || 'sync_all'
                } catch {
                    // 如果不是 JSON，直接作为 action
                    action = Intent.shortcutParameter.value as string
                }
            }
        } else if (Intent.textsParameter && Intent.textsParameter.length > 0) {
            try {
                const params = JSON.parse(Intent.textsParameter[0])
                action = params.action || 'sync_all'
            } catch {
                action = Intent.textsParameter[0]
            }
        }

        addLog('Intent', action, 'success', `开始执行: ${action}`)

        // 获取设置
        const settings = getCurrentSettings()

        if (!settings.bookmark) {
            Script.exit(Intent.json({
                success: false,
                error: '未配置文件书签，请先在主脚本中设置'
            }))
            return
        }

        // 连接服务器
        const connectSuccess = await createConnection(settings)
        if (!connectSuccess) {
            Script.exit(Intent.json({
                success: false,
                error: errorMsg || '连接失败'
            }))
            return
        }

        // 执行操作
        if (action === 'sync_all' || action === 'download') {
            requestSyncAll()

            // 等待同步完成
            const success = await waitForComplete()

            disconnect()

            Script.exit(Intent.json({
                success,
                action,
                logs,
                error: success ? undefined : errorMsg
            }))
        } else {
            disconnect()
            Script.exit(Intent.json({
                success: false,
                error: `未知操作: ${action}，支持的操作: sync_all, download`
            }))
        }

    } catch (error) {
        disconnect()
        Script.exit(Intent.json({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        }))
    }
}

run()
