import { relative } from 'path'
import { SKIN_DIR } from '../config'
import type { WatchEvent, SocketClient, ClientConfig, DebounceMap, ServerWrittenFilesMap, ChunkAckWaiters } from '../types'
import { normalizePath, sendToClientDelete, broadcastFileUpdate, error } from '../utils'

/**
 * 处理文件系统事件
 */
export async function handleFileEvent(
    event: WatchEvent,
    absPath: string,
    socket: SocketClient | undefined,
    config: ClientConfig,
    debounceMap: DebounceMap,
    serverWrittenFiles: ServerWrittenFilesMap,
    chunkAckWaiters: ChunkAckWaiters
): Promise<void> {
    const relPath = relative(SKIN_DIR, absPath)

    // 忽略系统文件
    if (relPath === '.DS_Store' || relPath.endsWith('.DS_Store')) return

    // 忽略服务端刚刚写入的文件（防止回环）
    if (serverWrittenFiles.has(relPath)) return

    // 防抖：取消同一文件的重复事件
    const existingTimer = debounceMap.get(relPath)
    if (existingTimer) {
        clearTimeout(existingTimer)
    }

    // 设置新定时器
    debounceMap.set(relPath, setTimeout(async () => {
        debounceMap.delete(relPath)

        if (!socket) return

        try {
            switch (event) {
                case 'add':
                case 'change':
                    await broadcastFileUpdate(socket, config, relPath, absPath, false, chunkAckWaiters)
                    break

                case 'addDir':
                    await broadcastFileUpdate(socket, config, relPath, absPath, true, chunkAckWaiters)
                    break

                case 'unlink':
                case 'unlinkDir':
                    const payload = {
                        action: 'delete',
                        path: normalizePath(relPath),
                        content: null,
                        isDir: event === 'unlinkDir'
                    }
                    sendToClientDelete(socket, config, payload)
                    break
            }
        } catch (err) {
            error(`处理 ${relPath} 时出错:`, err)
        }
    }, 100))
}
