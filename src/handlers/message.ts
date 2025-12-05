import { join } from 'path'
import { mkdir } from 'fs/promises'
import { SKIN_DIR } from '../config'
import type { WSClient, ClientConfig, ClientsMap, ChunkReceiveStateMap, ChunkAckWaiters, ServerWrittenFilesMap } from '../types'
import { sendToClientJson, syncAllFiles } from '../utils'

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
 * 处理 WebSocket 消息
 */
export async function handleMessage(
    ws: WSClient,
    message: string | Buffer,
    clients: ClientsMap,
    chunkReceiveState: ChunkReceiveStateMap,
    chunkAckWaiters: ChunkAckWaiters,
    serverWrittenFiles: ServerWrittenFilesMap
): Promise<void> {
    try {
        const msg = typeof message === 'string' ? message : message.toString()
        const data = JSON.parse(msg)

        switch (data.action) {
            case 'sync_all':
                console.log('[WS] 收到客户端下载请求')
                syncAllFiles(ws, clients.get(ws) || {}, chunkAckWaiters).catch(err => {
                    console.error('[WS] 发送全部失败:', err)
                })
                break

            case 'configure':
                if (data.config) {
                    const config = clients.get(ws) || {}
                    clients.set(ws, { ...config, ...data.config })
                    console.log('[WS] 更新客户端配置:', data.config)
                }
                break

            case 'client_upload_start':
                console.log('[WS] 客户端开始上传全部文件...')
                break

            case 'client_upload_complete':
                console.log('[WS] 客户端上传全部完成')
                break

            case 'update':
                if (data.path && data.content !== undefined) {
                    const targetPath = join(SKIN_DIR, data.path)
                    const parentDir = join(targetPath, '..')
                    await mkdir(parentDir, { recursive: true })
                    if (data.encoding === 'base64') {
                        const buffer = Buffer.from(data.content, 'base64')
                        await Bun.write(targetPath, buffer)
                        markFileAsServerWritten(data.path, serverWrittenFiles)
                        console.log(`[WS] 客户端上传文件: ${data.path}`)
                    }
                }
                break

            case 'create_dir':
                if (data.path) {
                    const targetPath = join(SKIN_DIR, data.path)
                    try {
                        await Bun.file(targetPath).exists()
                        console.log(`[WS] 目录已存在或存在同名文件，跳过创建: ${data.path}`)
                    } catch {
                        await mkdir(targetPath, { recursive: true })
                        console.log(`[WS] 客户端创建目录: ${data.path}`)
                    }
                }
                break

            case 'chunk_start':
                if (data.fileId && data.path) {
                    chunkReceiveState.set(data.fileId, {
                        path: join(SKIN_DIR, data.path),
                        relPath: data.path,
                        receivedChunks: 0,
                        totalChunks: data.totalChunks || 0
                    })
                    console.log(`[WS] 开始接收分片: ${data.path}, 总分片数: ${data.totalChunks}`)
                }
                break

            case 'chunk_data':
                if (data.fileId && data.content !== undefined && data.chunkIndex !== undefined) {
                    const state = chunkReceiveState.get(data.fileId)
                    if (!state) {
                        console.error('[WS] 收到分片但未找到接收状态:', data.fileId)
                        sendToClientJson(ws, {
                            action: 'chunk_ack',
                            fileId: data.fileId,
                            chunkIndex: data.chunkIndex,
                            success: false,
                            error: '未找到接收状态'
                        })
                        break
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

                        sendToClientJson(ws, {
                            action: 'chunk_ack',
                            fileId: data.fileId,
                            chunkIndex: data.chunkIndex,
                            success: true
                        })

                        if (state.receivedChunks % 10 === 0 || state.receivedChunks === state.totalChunks) {
                            console.log(`[WS] 接收分片: ${state.receivedChunks}/${state.totalChunks}`)
                        }
                    } catch (err) {
                        console.error('[WS] 写入分片失败:', err)
                        sendToClientJson(ws, {
                            action: 'chunk_ack',
                            fileId: data.fileId,
                            chunkIndex: data.chunkIndex,
                            success: false,
                            error: (err as Error).message
                        })
                    }
                }
                break

            case 'chunk_complete':
                if (data.fileId) {
                    const state = chunkReceiveState.get(data.fileId)
                    if (state) {
                        console.log(`[WS] 客户端上传分片完成: ${data.path}, ${state.receivedChunks} 个分片`)
                        chunkReceiveState.delete(data.fileId)
                    }
                }
                break

            case 'chunk_ack':
                if (data.fileId && data.chunkIndex !== undefined) {
                    const key = `${data.fileId}-${data.chunkIndex}`
                    const resolver = chunkAckWaiters.get(key)
                    if (resolver) {
                        resolver(data.success !== false)
                        chunkAckWaiters.delete(key)
                    }
                }
                break

            default:
                console.log('[WS] 收到未知请求:', data)
                break
        }
    } catch (err) {
        console.error('[WS] 消息解析失败:', err)
    }
}
