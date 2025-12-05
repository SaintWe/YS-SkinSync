import { Server as SocketIOServer } from 'socket.io'
import { HOST, PORT, ADDRESS, VERSION } from './config'
import type { SocketClient, ClientConfig, ClientsMap, ChunkReceiveStateMap, ChunkAckWaiters, ServerWrittenFilesMap } from './types'
import { handleSocketMessage } from './handlers'

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
    console.log(`[WS] 版本: ${VERSION}`)
    console.log(`[WS] 服务启动中...`)

    io = new SocketIOServer(PORT, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        },
        transports: ['websocket', 'polling']
    })

    io.on('connection', (socket: SocketClient) => {
        if (clients.size > 0) {
            console.log(`[WS] 客户端连接失败，已存在连接的客户端，不允许多个客户端连接`)
            socket.disconnect()
            return
        }

        console.log(`[WS] 客户端连接`)
        clients.set(socket, {})

        // 注册消息处理器
        handleSocketMessage(socket, clients, chunkReceiveState, chunkAckWaiters, serverWrittenFiles)

        socket.on('disconnect', () => {
            console.log(`[WS] 客户端断开连接`)
            clients.delete(socket)
        })
    })

    console.log(`[WS] 监听地址: ws://${HOST}:${PORT}`)

    return io
}

/**
 * 获取 Socket.IO 服务器实例
 */
export function getIO(): SocketIOServer | null {
    return io
}
