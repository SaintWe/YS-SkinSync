import { join } from 'path'
import { readdir } from 'fs/promises'
import { SKIN_DIR } from '../config'
import type { ClientConfig, WSClient, ChunkAckWaiters } from '../types'
import { normalizePath } from './path'
import { validateFileSize, validatePath } from './validation'

/**
 * 向客户端发送 JSON 数据
 */
export function sendToClientJson(ws: WSClient, data: unknown): void {
    if (ws.readyState !== 1) return
    ws.send(JSON.stringify(data))
}

/**
 * 向客户端发送警告消息
 */
export function sendToClientWarning(ws: WSClient, title: string, message: string): void {
    sendToClientJson(ws, { action: 'server_log', path: title, status: 'warning', message })
}

/**
 * 向客户端发送删除广播
 */
export function sendToClientDelete(ws: WSClient, config: ClientConfig, data: { action: string; path: string; content: null; isDir: boolean }): void {
    const validation = validatePath(data.path, config)
    if (!validation.valid) {
        const title = `${data.action} -> ${data.path}`
        const message = validation.reason || '路径验证失败'
        sendToClientWarning(ws, title, message)
        console.log(`[WS] ${message}: ${title}`)
        return
    }
    sendToClientJson(ws, data)
    console.log(`[WS] 广播: ${data.action} -> ${data.path}`)
}

/**
 * 处理文件系统条目
 */
export async function processEntry(
    ws: WSClient,
    config: ClientConfig,
    relPath: string,
    absPath: string,
    isDir: boolean,
    recurse: (rel: string, abs: string) => Promise<void>,
    chunkAckWaiters: ChunkAckWaiters
): Promise<void> {
    const normalizedRelPath = normalizePath(relPath)

    // 验证路径
    const validation = validatePath(normalizedRelPath, config)
    if (!validation.valid) {
        const action = isDir ? 'create_dir' : 'update'
        const title = `${action} -> ${normalizedRelPath}`
        const message = validation.reason || '路径验证失败'
        sendToClientWarning(ws, title, message)
        console.log(`[WS] ${message}: ${title}`)
        return
    }

    if (isDir) {
        sendToClientJson(ws, { action: 'create_dir', path: normalizedRelPath, content: null, isDir: true })
        console.log(`[WS] 广播: create_dir -> ${normalizedRelPath}`)
        await recurse(relPath, absPath)
    } else {
        try {
            const file = Bun.file(absPath)
            const size = file.size
            const sizeValidation = validateFileSize(size, config)
            if (!sizeValidation.valid) {
                sendToClientWarning(ws, normalizedRelPath, sizeValidation.reason || '文件大小验证失败')
                console.log(`[WS] 文件过大，跳过 -> ${normalizedRelPath} (${sizeValidation.reason})`)
                return
            }

            const buffer = await file.arrayBuffer()
            const content = Buffer.from(buffer).toString('base64')

            const CHUNK_SIZE = 256 * 1024
            const needsChunking = content.length > CHUNK_SIZE

            if (needsChunking) {
                let fileSuccess = false
                for (let fileRetry = 0; fileRetry <= 3 && !fileSuccess; fileRetry++) {
                    if (fileRetry > 0) {
                        console.log(`[WS] 重试文件发送: ${normalizedRelPath}, 第 ${fileRetry} 次`)
                        await new Promise(resolve => setTimeout(resolve, 1000))
                    }

                    const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                    const totalChunks = Math.ceil(content.length / CHUNK_SIZE)

                    try {
                        sendToClientJson(ws, {
                            action: 'chunk_start',
                            path: normalizedRelPath,
                            fileId,
                            totalChunks,
                            totalSize: size,
                            isDir: false
                        })

                        console.log(`[WS] 开始发送分片: ${normalizedRelPath}, ${totalChunks} 个分片`)

                        let chunkFailure = false
                        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                            const start = chunkIndex * CHUNK_SIZE
                            const end = Math.min(start + CHUNK_SIZE, content.length)
                            const chunkContent = content.substring(start, end)

                            sendToClientJson(ws, {
                                action: 'chunk_data',
                                fileId,
                                chunkIndex,
                                content: chunkContent
                            })

                            await new Promise<void>((resolve) => {
                                const key = `${fileId}-${chunkIndex}`
                                chunkAckWaiters.set(key, (success) => {
                                    if (!success) {
                                        console.error(`[WS] 分片 ${chunkIndex} ACK 失败 (客户端接收错误)`)
                                        chunkFailure = true
                                    }
                                    resolve()
                                })
                                setTimeout(() => {
                                    if (chunkAckWaiters.has(key)) {
                                        chunkAckWaiters.delete(key)
                                        console.warn(`[WS] 分片 ${chunkIndex} ACK 超时`)
                                        chunkFailure = true
                                        resolve()
                                    }
                                }, 5000)
                            })

                            if (chunkFailure) break

                            if ((chunkIndex + 1) % 10 === 0 || chunkIndex === totalChunks - 1) {
                                console.log(`[WS] 发送分片: ${chunkIndex + 1}/${totalChunks}`)
                            }
                        }

                        if (!chunkFailure) {
                            sendToClientJson(ws, {
                                action: 'chunk_complete',
                                fileId,
                                path: normalizedRelPath
                            })
                            console.log(`[WS] 分片发送完成: ${normalizedRelPath}`)
                            fileSuccess = true
                        }
                    } catch (err) {
                        console.error(`[WS] 文件发送异常: ${normalizedRelPath}`, err)
                    }
                }

                if (!fileSuccess) {
                    console.error(`[WS] 文件发送失败 (多次重试后): ${normalizedRelPath}`)
                }
            } else {
                sendToClientJson(ws, {
                    action: 'update',
                    path: normalizedRelPath,
                    content,
                    isDir: false,
                    encoding: 'base64'
                })
                console.log(`[WS] 广播: update -> ${normalizedRelPath}`)
            }
        } catch (err) {
            console.error(`[WS] 读取文件失败 ${normalizedRelPath}:`, err)
        }
    }
}

/**
 * 广播文件更新
 */
export async function broadcastFileUpdate(
    ws: WSClient,
    config: ClientConfig,
    relPath: string,
    absPath: string,
    isDir: boolean,
    chunkAckWaiters: ChunkAckWaiters
): Promise<void> {
    await processEntry(
        ws,
        config,
        relPath,
        absPath,
        isDir,
        (rel, abs) => broadcastDirectoryContents(ws, config, rel, abs, chunkAckWaiters),
        chunkAckWaiters
    )
}

/**
 * 递归广播目录内容
 */
export async function broadcastDirectoryContents(
    ws: WSClient,
    config: ClientConfig,
    relPath: string,
    absPath: string,
    chunkAckWaiters: ChunkAckWaiters
): Promise<void> {
    try {
        const entries = await readdir(absPath, { withFileTypes: true })
        for (const entry of entries) {
            if (entry.name === '.DS_Store') continue
            const entryRelPath = relPath ? join(relPath, entry.name) : entry.name
            const entryAbsPath = join(absPath, entry.name)
            await broadcastFileUpdate(ws, config, entryRelPath, entryAbsPath, entry.isDirectory(), chunkAckWaiters)
        }
    } catch (err) {
        console.error(`[WS] 读取目录失败 ${relPath}:`, err)
    }
}

/**
 * 同步全部文件
 */
export async function syncAllFiles(ws: WSClient, config: ClientConfig, chunkAckWaiters: ChunkAckWaiters): Promise<void> {
    console.log('[WS] 开始上传全部...')

    sendToClientJson(ws, { action: 'sync_start', path: '', content: null, isDir: false })

    try {
        await broadcastDirectoryContents(ws, config, '', SKIN_DIR, chunkAckWaiters)

        sendToClientJson(ws, {
            action: 'sync_complete',
            path: '',
            content: null,
            isDir: false
        })

        console.log('[WS] 上传全部完成')
    } catch (err) {
        console.error('[WS] 上传全部失败:', err)
        sendToClientJson(ws, {
            action: 'sync_error',
            path: '',
            content: (err as Error).message,
            isDir: false
        })
    }
}
