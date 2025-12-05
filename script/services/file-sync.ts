import { Path } from 'scripting'
import type { FileChangeEvent, ChunkReceiveState, ChunkAckWaiter, SyncLog } from '../types'
import type { Settings } from '../utils'
import { shouldFilterPath } from '../utils'

/**
 * 处理文件同步事件
 */
export const handleFileSync = async (
    event: FileChangeEvent,
    options: {
        uploadingRef: { current: boolean }
        targetPathRef: { current: string | null }
        socketRef: { current: SocketIOClient | null }
        chunkReceiveStateRef: { current: Map<string, ChunkReceiveState> }
        chunkAckWaitersRef: { current: Map<string, ChunkAckWaiter> }
        settings: Settings
        addLog: (action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => void
        setSyncing: (syncing: boolean) => void
        setUploading?: (uploading: boolean) => void
    }
): Promise<void> => {
    const { uploadingRef, targetPathRef, socketRef, chunkReceiveStateRef, chunkAckWaitersRef, settings, addLog, setSyncing, setUploading } = options

    // 如果正在上传，忽略来自服务端的更新消息（防止回环）
    if (uploadingRef.current && (event.action === 'update' || event.action === 'create_dir' || event.action === 'delete')) {
        return
    }

    // 处理同步控制消息
    if (event.action === 'sync_start') {
        setSyncing(true)
        addLog('下载全部', '开始', 'success', '正在同步所有文件...')
        return
    }

    if (event.action === 'sync_complete') {
        setTimeout(() => { setSyncing(false) }, 100)
        addLog('下载全部', '完成', 'success', '所有文件已同步完成')
        return
    }

    if (event.action === 'sync_error') {
        setSyncing(false)
        addLog('下载全部', '失败', 'error', event.content || '未知错误')
        return
    }

    // 处理分片开始
    if (event.action === 'chunk_start' && event.fileId) {
        const currentTargetPath = targetPathRef.current
        if (!currentTargetPath) {
            addLog('分片接收', event.path, 'error', '未设置目标目录')
            return
        }
        const fullPath = Path.join(currentTargetPath, event.path)
        const parentDir = Path.dirname(fullPath)
        if (!await FileManager.exists(parentDir)) {
            await FileManager.createDirectory(parentDir, true)
        }

        chunkReceiveStateRef.current.set(event.fileId, {
            path: fullPath,
            receivedChunks: 0,
            totalChunks: event.totalChunks || 0
        })

        addLog('开始接收', event.path, 'success', `文件大小: ${((event.totalSize || 0) / 1024).toFixed(1)}KB, 分片数: ${event.totalChunks}`)
        return
    }

    // 处理分片数据
    if (event.action === 'chunk_data' && event.fileId && event.content) {
        const state = chunkReceiveStateRef.current.get(event.fileId)
        if (!state) {
            console.error('收到分片但未找到接收状态:', event.fileId)
            return
        }

        try {
            const data = Data.fromBase64String(event.content)
            if (!data) throw new Error('Base64 解码失败')

            if (event.chunkIndex === 0) {
                await FileManager.writeAsData(state.path, data)
            } else {
                await FileManager.appendData(state.path, data)
            }

            state.receivedChunks++

            if (socketRef.current) {
                socketRef.current.emit('chunk_ack', {
                    fileId: event.fileId,
                    chunkIndex: event.chunkIndex,
                    success: true
                })
            }

            // 按百分比输出日志（每20%或最后一片）
            const progress = Math.floor((state.receivedChunks / state.totalChunks) * 5)
            const prevProgress = Math.floor(((state.receivedChunks - 1) / state.totalChunks) * 5)
            if (progress > prevProgress || state.receivedChunks === state.totalChunks) {
                addLog('接收分片', event.path || '未知文件', 'success', `${state.receivedChunks}/${state.totalChunks} (${Math.round((state.receivedChunks / state.totalChunks) * 100)}%)`)
            }
        } catch (error) {
            if (socketRef.current) {
                socketRef.current.emit('chunk_ack', {
                    fileId: event.fileId,
                    chunkIndex: event.chunkIndex,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                })
            }
            const errorMsg = error instanceof Error ? error.message : String(error)
            addLog('接收分片', event.path || '未知文件', 'error', `分片 ${event.chunkIndex} 失败: ${errorMsg}`)
        }
        return
    }

    // 处理分片完成
    if (event.action === 'chunk_complete' && event.fileId) {
        const state = chunkReceiveStateRef.current.get(event.fileId)
        if (state) {
            addLog('接收完成', event.path, 'success', `${state.receivedChunks} 个分片`)
            chunkReceiveStateRef.current.delete(event.fileId)
        }
        return
    }

    // 处理分片 ACK
    if (event.action === 'chunk_ack' && event.fileId !== undefined && event.chunkIndex !== undefined) {
        const key = `${event.fileId}-${event.chunkIndex}`
        const resolver = chunkAckWaitersRef.current.get(key)
        if (resolver) {
            resolver(event.success !== false)
            chunkAckWaitersRef.current.delete(key)
        }
        return
    }

    // 处理服务端日志
    if (event.action === 'server_log') {
        // @ts-ignore
        addLog(event.path || '服务端', event.content || '', event.status || 'success', event.message)
        return
    }

    // 检查目标路径
    const currentTargetPath = targetPathRef.current
    if (!currentTargetPath) {
        addLog(event.action, event.path, 'error', '未设置目标目录')
        return
    }

    // 检查过滤规则
    if (shouldFilterPath(event.path, settings.pathRegex || [])) {
        addLog('跳过', event.path, 'warning', '匹配过滤规则')
        return
    }

    try {
        const fullPath = Path.join(currentTargetPath, event.path)

        if (event.action === 'delete') {
            addLog('删除', event.path, 'success')
            if (await FileManager.exists(fullPath)) {
                await FileManager.remove(fullPath)
            }
        } else if (event.action === 'create_dir') {
            addLog('创建目录', event.path, 'success')
            if (!await FileManager.exists(fullPath)) {
                await FileManager.createDirectory(fullPath, true)
            }
        } else if (event.action === 'update') {
            if (event.content !== null) {
                addLog('更新文件', event.path, 'success')
                const parentDir = Path.dirname(fullPath)
                if (!await FileManager.exists(parentDir)) {
                    await FileManager.createDirectory(parentDir, true)
                }
                const data = Data.fromBase64String(event.content)
                if (data) {
                    await FileManager.writeAsData(fullPath, data)
                } else {
                    throw new Error('Base64 解码失败')
                }
            }
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        addLog(event.action, event.path, 'error', errorMsg)
        console.error('文件同步失败:', error)
    }
}

/**
 * 上传全部文件
 */
export const uploadAllFiles = async (
    options: {
        socketRef: { current: SocketIOClient | null }
        targetPathRef: { current: string | null }
        chunkAckWaitersRef: { current: Map<string, ChunkAckWaiter> }
        settings: Settings
        addLog: (action: string, path: string, status: 'success' | 'error' | 'warning', message?: string) => void
        setUploading: (uploading: boolean) => void
        uploadingRef: { current: boolean }
        setErrorMessage: (message: string) => void
        connected: boolean
        setSyncing?: (syncing: boolean) => void
    }
): Promise<void> => {
    const { socketRef, targetPathRef, chunkAckWaitersRef, settings, addLog, setUploading, uploadingRef, setErrorMessage, connected, setSyncing } = options

    // 检查连接是否有效的辅助函数
    const isConnected = () => socketRef.current !== null

    if (!socketRef.current || !connected) {
        setErrorMessage('请先连接到服务器')
        return
    }

    const currentTargetPath = targetPathRef.current
    if (!currentTargetPath) {
        setErrorMessage('未设置目标目录')
        return
    }

    setUploading(true)
    uploadingRef.current = true
    addLog('上传全部', '开始', 'success', '正在扫描并上传文件...')

    try {
        socketRef.current.emit('client_upload_start', {})

        const scanAndSend = async (dirPath: string, relPath: string) => {
            // 检查连接状态
            if (!isConnected()) {
                throw new Error('连接已断开')
            }

            const items = await FileManager.readDirectory(dirPath)
            for (const item of items) {
                // 每个文件前检查连接状态
                if (!isConnected()) {
                    throw new Error('连接已断开')
                }

                const itemRelPath = relPath ? Path.join(relPath, item) : item

                if (shouldFilterPath(itemRelPath, settings.pathRegex || [])) {
                    addLog('跳过', itemRelPath, 'warning', '匹配过滤规则')
                    continue
                }

                const itemPath = Path.join(dirPath, item)

                if (await FileManager.isDirectory(itemPath)) {
                    socketRef.current?.emit('create_dir', {
                        path: itemRelPath,
                        isDir: true
                    })
                    addLog('创建目录', itemRelPath, 'success')
                    await scanAndSend(itemPath, itemRelPath)
                } else {
                    const stat = await FileManager.stat(itemPath)

                    if (settings.enableFileSizeLimit && settings.maxFileSize && stat.size > settings.maxFileSize) {
                        addLog('跳过', itemRelPath, 'warning', `文件过大 (${(stat.size / 1024).toFixed(1)}KB)`)
                        continue
                    }

                    const data = await FileManager.readAsData(itemPath)
                    const content = data.toBase64String()
                    const CHUNK_SIZE = 256 * 1024
                    const needsChunking = content.length > CHUNK_SIZE

                    if (needsChunking) {
                        let fileSuccess = false
                        for (let fileRetry = 0; fileRetry <= 3 && !fileSuccess; fileRetry++) {
                            if (fileRetry > 0) {
                                addLog('重试文件', itemRelPath, 'warning', `第 ${fileRetry} 次重试`)
                                await new Promise<void>(resolve => setTimeout(resolve, 1000))
                            }

                            const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                            const totalChunks = Math.ceil(content.length / CHUNK_SIZE)

                            try {
                                socketRef.current?.emit('chunk_start', {
                                    path: itemRelPath,
                                    fileId,
                                    totalChunks,
                                    totalSize: stat.size,
                                    isDir: false
                                })

                                addLog('开始发送', itemRelPath, 'success', `${totalChunks} 个分片`)

                                let chunkFailure = false
                                for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                                    // 检查连接状态
                                    if (!isConnected()) {
                                        throw new Error('连接已断开')
                                    }

                                    const start = chunkIndex * CHUNK_SIZE
                                    const end = Math.min(start + CHUNK_SIZE, content.length)
                                    const chunkContent = content.substring(start, end)

                                    socketRef.current?.emit('chunk_data', {
                                        fileId,
                                        chunkIndex,
                                        content: chunkContent
                                    })

                                    const success = await new Promise<boolean>((resolve) => {
                                        const key = `${fileId}-${chunkIndex}`
                                        chunkAckWaitersRef.current.set(key, (s: boolean) => resolve(s))
                                        setTimeout(() => {
                                            if (chunkAckWaitersRef.current.has(key)) {
                                                chunkAckWaitersRef.current.delete(key)
                                                resolve(false)
                                            }
                                        }, 5000)
                                    })

                                    if (!success) {
                                        addLog('发送失败', itemRelPath, 'error', `分片 ${chunkIndex} ACK 超时`)
                                        chunkFailure = true
                                        break
                                    }

                                    if ((chunkIndex + 1) % 10 === 0 || chunkIndex === totalChunks - 1) {
                                        addLog('发送分片', itemRelPath, 'success', `${chunkIndex + 1}/${totalChunks}`)
                                    }
                                }

                                if (!chunkFailure) {
                                    socketRef.current?.emit('chunk_complete', {
                                        fileId,
                                        path: itemRelPath
                                    })
                                    addLog('发送完成', itemRelPath, 'success')
                                    fileSuccess = true
                                }
                            } catch (err) {
                                console.error('文件发送异常:', err)
                            }
                        }

                        if (!fileSuccess) {
                            addLog('上传失败', itemRelPath, 'error', '多次重试后仍失败')
                        }
                    } else {
                        socketRef.current?.emit('update', {
                            path: itemRelPath,
                            content,
                            encoding: 'base64',
                            isDir: false
                        })
                        addLog('上传文件', itemRelPath, 'success')
                    }
                }
            }
        }

        await scanAndSend(currentTargetPath, '')

        if (isConnected()) {
            socketRef.current!.emit('client_upload_complete', {})
            await new Promise<void>(resolve => setTimeout(resolve, 500))
            addLog('上传全部', '完成', 'success', '所有文件已上传')
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        if (errorMsg === '连接已断开') {
            addLog('上传全部', '中断', 'warning', '连接已断开，上传已停止')
        } else {
            addLog('上传全部', '失败', 'error', errorMsg)
        }
    } finally {
        setUploading(false)
        uploadingRef.current = false
        // 清理所有等待中的 ACK
        chunkAckWaitersRef.current.forEach((resolver) => resolver(false))
        chunkAckWaitersRef.current.clear()
    }
}
