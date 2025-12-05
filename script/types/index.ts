/**
 * 同步日志类型
 */
export type SyncLog = {
    time: string
    action: string
    path: string
    status: 'success' | 'error' | 'warning'
    message?: string
}

/**
 * 文件变更事件类型
 */
export type FileChangeEvent = {
    action: 'update' | 'delete' | 'create_dir' | 'sync_start' | 'sync_complete' | 'sync_error' | 'server_log'
    | 'chunk_start' | 'chunk_data' | 'chunk_ack' | 'chunk_complete'
    path: string
    content: string | null
    isDir: boolean
    encoding?: string
    status?: 'success' | 'error' | 'warning'
    message?: string
    // 分片相关字段
    fileId?: string
    totalChunks?: number
    totalSize?: number
    chunkIndex?: number
    success?: boolean  // ACK 成功标志
    error?: string     // ACK 错误信息
}

/**
 * 连接状态类型
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

/**
 * 分片接收状态
 */
export type ChunkReceiveState = {
    path: string
    receivedChunks: number
    totalChunks: number
}

/**
 * 分片 ACK 等待器
 */
export type ChunkAckWaiter = (success: boolean) => void
