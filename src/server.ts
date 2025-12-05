import type { Server } from 'bun'
import { HOST, PORT, ADDRESS, VERSION } from './config'
import type { WSClient, ClientConfig, ClientsMap, ChunkReceiveStateMap, ChunkAckWaiters, ServerWrittenFilesMap } from './types'
import { handleMessage } from './handlers'

// 存储客户端连接及其配置
export const clients: ClientsMap = new Map()

// 服务端分片接收状态
export const chunkReceiveState: ChunkReceiveStateMap = new Map()

// 服务端发送分片 ACK 等待
export const chunkAckWaiters: ChunkAckWaiters = new Map()

// 记录服务端写入的文件（防止回环）
export const serverWrittenFiles: ServerWrittenFilesMap = new Map()

/**
 * 创建 WebSocket 服务器
 */
export function createServer(): ReturnType<typeof Bun.serve> {
    console.log(`[WS] 版本: ${VERSION}`)
    console.log(`[WS] 服务启动中...`)

    const server = Bun.serve({
        hostname: HOST,
        port: PORT,
        fetch(req: Request, server: Server<unknown>) {
            if (server.upgrade(req, { data: {} })) {
                return
            }
            return new Response(`正在监听 skin 目录，请通过 ${ADDRESS} 连接`, { status: 200 })
        },
        websocket: {
            open(ws: WSClient) {
                if (clients.size > 0) {
                    console.log(`[WS] 客户端连接失败，已存在连接的客户端，不允许多个客户端连接`)
                    ws.close()
                    return
                }
                console.log(`[WS] 客户端连接`)
                clients.set(ws, {})
            },
            async message(ws: WSClient, message: string | Buffer) {
                await handleMessage(ws, message, clients, chunkReceiveState, chunkAckWaiters, serverWrittenFiles)
            },
            close(ws: WSClient) {
                console.log(`[WS] 客户端断开连接`)
                clients.delete(ws)
            },
        },
    })

    console.log(`[WS] 监听地址: ${ADDRESS}`)

    return server
}
