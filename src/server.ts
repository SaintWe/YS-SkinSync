import { Server as SocketIOServer } from 'socket.io'
import { mkdirSync, existsSync } from 'fs'
import { HOST, PORT, VERSION, SKIN_DIR } from './config'
import type { SocketClient, ClientsMap, ChunkReceiveStateMap, ChunkAckWaiters, ServerWrittenFilesMap } from './types'
import { handleSocketMessage } from './handlers'
import { log } from './utils/log'

// 存储客户端连接及其配置
export const clients: ClientsMap = new Map()

// 服务端分片接收状态
export const chunkReceiveState: ChunkReceiveStateMap = new Map()

// 服务端发送分片 ACK 等待
export const chunkAckWaiters: ChunkAckWaiters = new Map()

// 记录服务端写入的文件（防止回环）
export const serverWrittenFiles: ServerWrittenFilesMap = new Map()

// Socket.IO 服务器实例
let io: SocketIOServer | null = null

/**
 * 创建 Socket.IO 服务器
 */
export function createServer(): SocketIOServer {
    log(`版本: ${VERSION}`)
    log(`服务启动中...`)

    // 自动创建同步目录（如果不存在）
    if (!existsSync(SKIN_DIR)) {
        mkdirSync(SKIN_DIR, { recursive: true })
        log(`已创建同步目录: ${SKIN_DIR}`)
    }

    io = new SocketIOServer(PORT, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        },
        transports: ['websocket', 'polling']
    })

    io.on('connection', (socket: SocketClient) => {
        if (clients.size > 0) {
            log(`客户端连接失败，已存在连接的客户端，不允许多个客户端连接`)
            socket.emit('connection_rejected', { message: '连接失败：已有其他客户端连接，不允许多个客户端同时连接' })
            socket.disconnect()
            return
        }

        log(`客户端连接`)
        clients.set(socket, {})

        // 注册消息处理器
        handleSocketMessage(socket, clients, chunkReceiveState, chunkAckWaiters, serverWrittenFiles)

        socket.on('disconnect', () => {
            log(`客户端断开连接`)
            clients.delete(socket)

            // 清理内存：清空所有缓存的 Map
            chunkReceiveState.clear()
            chunkAckWaiters.clear()

            // 清理 serverWrittenFiles 的定时器
            for (const timer of serverWrittenFiles.values()) {
                clearTimeout(timer)
            }
            serverWrittenFiles.clear()

        })
    })

    log(`监听地址: http://${HOST}:${PORT}`)

    return io
}

/**
 * 获取 Socket.IO 服务器实例
 */
export function getIO(): SocketIOServer | null {
    return io
}
