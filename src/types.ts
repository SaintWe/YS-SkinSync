import type { Socket } from 'socket.io'

/**
 * 客户端配置
 */
export interface ClientConfig {
    enableFileSizeLimit?: boolean
    maxFileSize?: number
    pathRegex?: string[]
}

/**
 * 文件监控事件类型
 */
export type WatchEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir' | 'ready' | 'error' | 'raw' | 'all'

/**
 * 分片接收状态
 */
export interface ChunkReceiveState {
    path: string
    relPath: string
    receivedChunks: number
    totalChunks: number
}

/**
 * 验证结果
 */
export interface ValidationResult {
    valid: boolean
    reason?: string
}

/**
 * Socket.IO 客户端类型
 */
export type SocketClient = Socket

/**
 * 客户端映射类型
 */
export type ClientsMap = Map<SocketClient, ClientConfig>

/**
 * 分片 ACK 等待器类型
 */
export type ChunkAckWaiters = Map<string, (success: boolean) => void>

/**
 * 分片接收状态映射类型
 */
export type ChunkReceiveStateMap = Map<string, ChunkReceiveState>

/**
 * 服务端写入文件映射类型（用于防止回环）
 */
export type ServerWrittenFilesMap = Map<string, Timer>

/**
 * 防抖映射类型
 */
export type DebounceMap = Map<string, ReturnType<typeof setTimeout>>

