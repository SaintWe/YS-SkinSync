/**
 * 此文件用于启动 WebSocket 服务器
 * 并监控皮肤文件变化，发送给客户端
 */
/// <reference types="bun-types" />
import { createServer, createWatcher, serverWrittenFiles, chunkAckWaiters, clients } from './src'

// 启动
const server = createServer()

// 文件监控
const watcher = createWatcher(clients, serverWrittenFiles, chunkAckWaiters)

// 退出
const shutdown = () => {
    watcher.close().then(() => {
        console.log('[WS] 正在关闭服务器...')
        server.stop()
        process.exit(0)
    })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
