import { relative } from 'path'
import { SKIN_DIR } from '../config'
import type { WatchEvent, WSClient, ClientConfig, DebounceMap, ServerWrittenFilesMap, ChunkAckWaiters } from '../types'
import { normalizePath, sendToClientDelete, broadcastFileUpdate } from '../utils'

/**
 * 处理文件系统事件
 */
export async function handleFileEvent(
    event: WatchEvent,
    absPath: string,
    ws: WSClient | undefined,
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

        if (!ws) return

        try {
            switch (event) {
                case 'add':
                case 'change':
                    await broadcastFileUpdate(ws, config, relPath, absPath, false, chunkAckWaiters)
                    break

                case 'addDir':
                    await broadcastFileUpdate(ws, config, relPath, absPath, true, chunkAckWaiters)
                    break

                case 'unlink':
                case 'unlinkDir':
                    const payload = {
                        action: 'delete',
                        path: normalizePath(relPath),
                        content: null,
                        isDir: event === 'unlinkDir'
                    }
                    sendToClientDelete(ws, config, payload)
                    break
            }
        } catch (error) {
            console.error(`[WS] 处理 ${relPath} 时出错:`, error)
        }
    }, 100))
}
