import chokidar from 'chokidar'
import { SKIN_DIR } from './config'
import type { WatchEvent, DebounceMap, ClientsMap, ServerWrittenFilesMap, ChunkAckWaiters } from './types'
import { handleFileEvent } from './handlers'

// 防抖映射
export const debounceMap: DebounceMap = new Map()

/**
 * 创建文件监控器
 */
export function createWatcher(
    clients: ClientsMap,
    serverWrittenFiles: ServerWrittenFilesMap,
    chunkAckWaiters: ChunkAckWaiters
): ReturnType<typeof chokidar.watch> {
    console.log(`[WS] 监听目录: ${SKIN_DIR}`)

    const watcher = chokidar.watch(SKIN_DIR, {
        ignored: /(^|[/\\])\../, // 忽略隐藏文件
        ignoreInitial: true,
        persistent: true
    })

    watcher.on('all', (event: WatchEvent, absPath: string) => {
        const socket = clients.keys().next().value
        const config = socket ? clients.get(socket) || {} : {}
        handleFileEvent(event, absPath, socket, config, debounceMap, serverWrittenFiles, chunkAckWaiters)
    })

    watcher.on('error', error => {
        console.error(`[WS] 监控错误: ${error}`)
    })

    return watcher
}
