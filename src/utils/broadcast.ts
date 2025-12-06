import { join } from 'path'
import { readdir } from 'fs/promises'
import { SKIN_DIR } from '../config'
import type { ClientConfig, SocketClient, ChunkAckWaiters } from '../types'
import { normalizePath } from './path'
import { validateFileSize, validatePath } from './validation'
import { log, warn, error, logChunkProgress } from './log'

/**
 * 检查客户端是否仍连接
 */
export function isSocketConnected(socket: SocketClient): boolean {
    return socket.connected
}

/**
 * 向客户端发送消息
 */
export function sendToClientJson(socket: SocketClient, data: { action: string;[key: string]: any }): boolean {
    if (!socket.connected) {
        return false
    }
    socket.emit(data.action, data)
    return true
}

/**
 * 向客户端发送警告消息
 */
export function sendToClientWarning(socket: SocketClient, title: string, message: string): void {
    sendToClientJson(socket, { action: 'server_log', path: title, status: 'warning', message })
}

/**
 * 向客户端发送删除广播
 */
export function sendToClientDelete(socket: SocketClient, config: ClientConfig, data: { action: string; path: string; content: null; isDir: boolean }): void {
    const validation = validatePath(data.path, config)
    if (!validation.valid) {
        const title = `${data.action} -> ${data.path}`
        const reason = validation.reason || '路径验证失败'
        sendToClientWarning(socket, title, reason)
        log(`${reason}: ${title}`)
        return
    }
    sendToClientJson(socket, data)
    log(`广播: ${data.action} -> ${data.path}`)
}

/**
 * 处理文件系统条目
 */
export async function processEntry(
    socket: SocketClient,
    config: ClientConfig,
    relPath: string,
    absPath: string,
    isDir: boolean,
    recurse: (rel: string, abs: string) => Promise<void>,
    chunkAckWaiters: ChunkAckWaiters
): Promise<void> {
    // 检查客户端连接状态
    if (!isSocketConnected(socket)) {
        return
    }

    const normalizedRelPath = normalizePath(relPath)

    // 验证路径
    const validation = validatePath(normalizedRelPath, config)
    if (!validation.valid) {
        const action = isDir ? 'create_dir' : 'update'
        const title = `${action} -> ${normalizedRelPath}`
        const reason = validation.reason || '路径验证失败'
        sendToClientWarning(socket, title, reason)
        log(`${reason}: ${title}`)
        return
    }

    if (isDir) {
        sendToClientJson(socket, { action: 'create_dir', path: normalizedRelPath, content: null, isDir: true })
        log(`广播: create_dir -> ${normalizedRelPath}`)
        await recurse(relPath, absPath)
    } else {
        try {
            const file = Bun.file(absPath)
            const size = file.size
            const sizeValidation = validateFileSize(size, config)
            if (!sizeValidation.valid) {
                sendToClientWarning(socket, normalizedRelPath, sizeValidation.reason || '文件大小验证失败')
                log(`文件过大，跳过 -> ${normalizedRelPath} (${sizeValidation.reason})`)
                return
            }

            const buffer = await file.arrayBuffer()
            const content = Buffer.from(buffer).toString('base64')

            const CHUNK_SIZE = 256 * 1024
            const needsChunking = content.length > CHUNK_SIZE

            if (needsChunking) {
                let fileSuccess = false
                for (let fileRetry = 0; fileRetry <= 3 && !fileSuccess; fileRetry++) {
                    // 检查客户端连接状态
                    if (!isSocketConnected(socket)) {
                        log(`客户端已断开，停止发送: ${normalizedRelPath}`)
                        return
                    }

                    if (fileRetry > 0) {
                        log(`重试文件发送: ${normalizedRelPath}, 第 ${fileRetry} 次`)
                        await new Promise(resolve => setTimeout(resolve, 1000))
                    }

                    const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                    const totalChunks = Math.ceil(content.length / CHUNK_SIZE)

                    try {
                        sendToClientJson(socket, {
                            action: 'chunk_start',
                            path: normalizedRelPath,
                            fileId,
                            totalChunks,
                            totalSize: size,
                            isDir: false
                        })

                        log(`开始发送分片: ${normalizedRelPath}, ${totalChunks} 个分片`)

                        let chunkFailure = false
                        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                            // 检查客户端连接状态
                            if (!isSocketConnected(socket)) {
                                log(`客户端已断开，停止发送: ${normalizedRelPath}`)
                                chunkFailure = true
                                break
                            }

                            const start = chunkIndex * CHUNK_SIZE
                            const end = Math.min(start + CHUNK_SIZE, content.length)
                            const chunkContent = content.substring(start, end)

                            if (!sendToClientJson(socket, {
                                action: 'chunk_data',
                                fileId,
                                chunkIndex,
                                content: chunkContent,
                                path: normalizedRelPath
                            })) {
                                log(`客户端已断开，停止发送: ${normalizedRelPath}`)
                                chunkFailure = true
                                break
                            }

                            await new Promise<void>((resolve) => {
                                const key = `${fileId}-${chunkIndex}`
                                chunkAckWaiters.set(key, (success) => {
                                    if (!success) {
                                        error(`分片 ${chunkIndex} ACK 失败 (客户端接收错误)`)
                                        chunkFailure = true
                                    }
                                    resolve()
                                })
                                setTimeout(() => {
                                    if (chunkAckWaiters.has(key)) {
                                        chunkAckWaiters.delete(key)
                                        if (!isSocketConnected(socket)) {
                                            log(`客户端已断开，停止等待 ACK`)
                                        } else {
                                            warn(`分片 ${chunkIndex} ACK 超时`)
                                        }
                                        chunkFailure = true
                                        resolve()
                                    }
                                }, 5000)
                            })

                            if (chunkFailure) break

                            logChunkProgress(chunkIndex, totalChunks, '发送分片')
                        }

                        if (!chunkFailure) {
                            sendToClientJson(socket, {
                                action: 'chunk_complete',
                                fileId,
                                path: normalizedRelPath
                            })
                            log(`分片发送完成: ${normalizedRelPath}`)
                            fileSuccess = true
                        }
                    } catch (err) {
                        error(`文件发送异常: ${normalizedRelPath}`, err)
                    }
                }

                if (!fileSuccess) {
                    error(`文件发送失败 (多次重试后): ${normalizedRelPath}`)
                }
            } else {
                sendToClientJson(socket, {
                    action: 'update',
                    path: normalizedRelPath,
                    content,
                    isDir: false,
                    encoding: 'base64'
                })
                log(`广播: update -> ${normalizedRelPath}`)
            }
        } catch (err) {
            error(`读取文件失败 ${normalizedRelPath}:`, err)
        }
    }
}

/**
 * 广播文件更新
 */
export async function broadcastFileUpdate(
    socket: SocketClient,
    config: ClientConfig,
    relPath: string,
    absPath: string,
    isDir: boolean,
    chunkAckWaiters: ChunkAckWaiters
): Promise<void> {
    await processEntry(
        socket,
        config,
        relPath,
        absPath,
        isDir,
        (rel, abs) => broadcastDirectoryContents(socket, config, rel, abs, chunkAckWaiters),
        chunkAckWaiters
    )
}

/**
 * 递归广播目录内容
 */
export async function broadcastDirectoryContents(
    socket: SocketClient,
    config: ClientConfig,
    relPath: string,
    absPath: string,
    chunkAckWaiters: ChunkAckWaiters
): Promise<void> {
    // 检查客户端连接状态
    if (!isSocketConnected(socket)) {
        return
    }

    try {
        const entries = await readdir(absPath, { withFileTypes: true })
        for (const entry of entries) {
            // 每个文件前检查连接状态
            if (!isSocketConnected(socket)) {
                log(`客户端已断开，停止目录遍历`)
                return
            }

            if (entry.name === '.DS_Store') continue
            const entryRelPath = relPath ? join(relPath, entry.name) : entry.name
            const entryAbsPath = join(absPath, entry.name)
            await broadcastFileUpdate(socket, config, entryRelPath, entryAbsPath, entry.isDirectory(), chunkAckWaiters)
        }
    } catch (err) {
        error(`读取目录失败 ${relPath}:`, err)
    }
}

/**
 * 同步全部文件
 */
export async function syncAllFiles(socket: SocketClient, config: ClientConfig, chunkAckWaiters: ChunkAckWaiters): Promise<void> {
    log('开始上传全部...')

    sendToClientJson(socket, { action: 'sync_start', path: '', content: null, isDir: false })

    try {
        await broadcastDirectoryContents(socket, config, '', SKIN_DIR, chunkAckWaiters)

        // 检查客户端连接状态
        if (isSocketConnected(socket)) {
            sendToClientJson(socket, {
                action: 'sync_complete',
                path: '',
                content: null,
                isDir: false
            })
            log('上传全部完成')
        } else {
            log('客户端已断开，上传中止')
        }
    } catch (err) {
        error('上传全部失败:', err)
        if (isSocketConnected(socket)) {
            sendToClientJson(socket, {
                action: 'sync_error',
                path: '',
                content: (err as Error).message,
                isDir: false
            })
        }
    }
}
