import { join } from 'path'
import { mkdir } from 'fs/promises'
import { SKIN_DIR } from '../config'
import type { SocketClient, ClientConfig, ClientsMap, ChunkReceiveStateMap, ChunkAckWaiters, ServerWrittenFilesMap } from '../types'
import { syncAllFiles } from '../utils'
import { log, error, logChunkProgress } from '../utils/log'

/**
 * 从可能是数组的数据中提取实际数据
 */
function extractData<T>(rawData: any): T {
    return Array.isArray(rawData) ? rawData[0] : rawData
}

/**
 * 标记文件为服务端写入
 */
export function markFileAsServerWritten(relPath: string, serverWrittenFiles: ServerWrittenFilesMap): void {
    const existing = serverWrittenFiles.get(relPath)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
        serverWrittenFiles.delete(relPath)
    }, 2000)
    serverWrittenFiles.set(relPath, timer)
}

/**
 * 发送消息给客户端
 */
export function sendToClient(socket: SocketClient, event: string, data: any): void {
    socket.emit(event, data)
}

/**
 * 注册 Socket.IO 消息处理器
 */
export function handleSocketMessage(
    socket: SocketClient,
    clients: ClientsMap,
    chunkReceiveState: ChunkReceiveStateMap,
    chunkAckWaiters: ChunkAckWaiters,
    serverWrittenFiles: ServerWrittenFilesMap
): void {
    // 配置客户端
    socket.on('configure', (rawData: any) => {
        const config = extractData<ClientConfig>(rawData)
        const existingConfig = clients.get(socket) || {}
        clients.set(socket, { ...existingConfig, ...config })
        log('更新客户端配置:', config)
    })

    // 请求下载全部
    socket.on('sync_all', () => {
        log('收到客户端下载请求')
        syncAllFiles(socket, clients.get(socket) || {}, chunkAckWaiters).catch(err => {
            error('发送全部失败:', err)
        })
    })

    // 客户端上传开始
    socket.on('client_upload_start', () => {
        log('客户端开始上传全部文件...')
    })

    // 客户端上传完成
    socket.on('client_upload_complete', () => {
        log('客户端上传全部完成')
    })

    // 文件更新
    socket.on('update', async (rawData: any) => {
        const data = extractData<{ path: string; content: string; encoding?: string }>(rawData)
        if (data?.path && data?.content !== undefined) {
            const targetPath = join(SKIN_DIR, data.path)
            const parentDir = join(targetPath, '..')
            await mkdir(parentDir, { recursive: true })
            if (data.encoding === 'base64') {
                const buffer = Buffer.from(data.content, 'base64')
                await Bun.write(targetPath, buffer)
                markFileAsServerWritten(data.path, serverWrittenFiles)
                log(`客户端上传文件: ${data.path}`)
            }
        }
    })

    // 创建目录
    socket.on('create_dir', async (rawData: any) => {
        const data = extractData<{ path: string }>(rawData)
        if (data?.path) {
            const targetPath = join(SKIN_DIR, data.path)
            try {
                const exists = await Bun.file(targetPath).exists()
                if (exists) {
                    log(`目录已存在或存在同名文件，跳过创建: ${data.path}`)
                } else {
                    await mkdir(targetPath, { recursive: true })
                    log(`客户端创建目录: ${data.path}`)
                }
            } catch {
                await mkdir(targetPath, { recursive: true })
                log(`客户端创建目录: ${data.path}`)
            }
        }
    })

    // 分片开始
    socket.on('chunk_start', (rawData: any) => {
        const data = extractData<{ fileId: string; path: string; totalChunks: number }>(rawData)
        if (data?.fileId && data?.path) {
            chunkReceiveState.set(data.fileId, {
                path: join(SKIN_DIR, data.path),
                relPath: data.path,
                receivedChunks: 0,
                totalChunks: data.totalChunks || 0
            })
            log(`开始接收分片: ${data.path}, 总分片数: ${data.totalChunks}`)
        }
    })

    // 分片数据
    socket.on('chunk_data', async (rawData: any) => {
        const data = extractData<{ fileId: string; chunkIndex: number; content: string }>(rawData)
        if (data?.fileId && data?.content !== undefined && data?.chunkIndex !== undefined) {
            const state = chunkReceiveState.get(data.fileId)
            if (!state) {
                error('收到分片但未找到接收状态:', data.fileId)
                sendToClient(socket, 'chunk_ack', {
                    fileId: data.fileId,
                    chunkIndex: data.chunkIndex,
                    success: false,
                    error: '未找到接收状态'
                })
                return
            }

            try {
                const buffer = Buffer.from(data.content, 'base64')
                const parentDir = join(state.path, '..')
                await mkdir(parentDir, { recursive: true })

                if (data.chunkIndex === 0) {
                    await Bun.write(state.path, buffer)
                } else {
                    const file = Bun.file(state.path)
                    const existing = await file.arrayBuffer()
                    const combined = new Uint8Array(existing.byteLength + buffer.length)
                    combined.set(new Uint8Array(existing), 0)
                    combined.set(buffer, existing.byteLength)
                    await Bun.write(state.path, combined)
                }

                markFileAsServerWritten(state.relPath, serverWrittenFiles)
                state.receivedChunks++

                sendToClient(socket, 'chunk_ack', {
                    fileId: data.fileId,
                    chunkIndex: data.chunkIndex,
                    success: true
                })

                logChunkProgress(state.receivedChunks, state.totalChunks, '接收分片', false)
            } catch (err) {
                error('写入分片失败:', err)
                sendToClient(socket, 'chunk_ack', {
                    fileId: data.fileId,
                    chunkIndex: data.chunkIndex,
                    success: false,
                    error: (err as Error).message
                })
            }
        }
    })

    // 分片完成
    socket.on('chunk_complete', (rawData: any) => {
        const data = extractData<{ fileId: string; path: string }>(rawData)
        if (data?.fileId) {
            const state = chunkReceiveState.get(data.fileId)
            if (state) {
                log(`客户端上传分片完成: ${data.path}, ${state.receivedChunks} 个分片`)
                chunkReceiveState.delete(data.fileId)
            }
        }
    })

    // 分片 ACK
    socket.on('chunk_ack', (rawData: any) => {
        const data = extractData<{ fileId: string; chunkIndex: number; success: boolean }>(rawData)
        if (data?.fileId && data?.chunkIndex !== undefined) {
            const key = `${data.fileId}-${data.chunkIndex}`
            const resolver = chunkAckWaiters.get(key)
            if (resolver) {
                resolver(data.success !== false)
                chunkAckWaiters.delete(key)
            }
        }
    })
}
