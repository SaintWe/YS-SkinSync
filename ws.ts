/**
 * 此文件用于启动 F11eSync 服务器
 * 并监控目录文件变化，发送给客户端
 */
/// <reference types="bun-types" />
import { createServer, createWatcher, serverWrittenFiles, chunkAckWaiters, clients } from './src'
import { CHECK_UPDATE_ONLY, DOWNLOAD_UPDATE } from './src/config'
import { log } from './src/utils/log'
import { checkUpdate, downloadUpdate } from './src/utils/update'

// 如果只是检查更新
if (CHECK_UPDATE_ONLY) {
    checkUpdate(false).then(() => process.exit(0))
} else if (DOWNLOAD_UPDATE) {
    // 下载新版本
    downloadUpdate().then(() => process.exit(0))
} else {
    // 启动时静默检查更新（有新版本才提示）
    checkUpdate(true)

    // 启动服务器
    const server = createServer()

    // 文件监控
    const watcher = createWatcher(clients, serverWrittenFiles, chunkAckWaiters)

    // 退出
    const shutdown = () => {
        watcher.close().then(() => {
            log('正在关闭服务器...')
            server.close()
            process.exit(0)
        })
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
}
