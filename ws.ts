/// <reference types="bun-types" />
import { watch } from "fs"
import { join, resolve } from "path"
import { type ServerWebSocket, type Server } from "bun"
import { stat, readdir, mkdir } from "fs/promises"

const PORT = 10080
// 兼容不同的运行环境(Bun 使用 import.meta.dir, Node.js 使用 import.meta.dirname)
const SKINS_DIR = resolve(import.meta.dirname || import.meta.dir || process.cwd(), "skin")

console.log(`[WS] 服务启动中...`)
console.log(`[WS] 监听目录: ${SKINS_DIR}`)
console.log(`[WS] 监听地址: ws://0.0.0.0:${PORT}`)

// 客户端配置接口
interface ClientConfig {
    maxFileSize?: number
    pathRegex?: string[]
}

// 存储客户端连接及其配置
const clients = new Map<ServerWebSocket<unknown>, ClientConfig>()

/**
 * 转Unix风格路径
 */
function normalizePath(path: string): string {
    return path.replace(/\\/g, '/')
}

/**
 * 检查路径是否应被过滤
 */
function shouldFilterPath(path: string, config: ClientConfig): boolean {
    if (!config.pathRegex || config.pathRegex.length === 0) return false
    const normalizedPath = normalizePath(path)
    for (const regexStr of config.pathRegex) {
        try {
            const regex = new RegExp(regexStr)
            if (regex.test(normalizedPath)) {
                return true
            }
        } catch (e) {
        }
    }
    return false
}

// 启动 Bun 服务器
const server = Bun.serve({
    hostname: "0.0.0.0",
    port: PORT,
    fetch(req: Request, server: Server<unknown>) {
        // Upgrade to WebSocket
        if (server.upgrade(req, { data: {} })) {
            return
        }
        return new Response(`正在监听 skins 目录，请通过 ws://0.0.0.0:${PORT} 连接`, { status: 200 })
    },
    websocket: {
        open(ws: ServerWebSocket<unknown>) {
            console.log(`[WS] 客户端连接`)
            clients.set(ws, {})
        },
        async message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
            try {
                const msg = typeof message === 'string' ? message : message.toString()
                const data = JSON.parse(msg)
                switch (data.action) {
                    case 'sync_all':
                        console.log('[WS] 收到客户端下载请求')
                        // 异步执行发送全部文件给客户端
                        syncAllFiles(ws).catch(err => {
                            console.error('[WS] 发送全部失败:', err)
                        })
                        break
                    case 'configure':
                        if (data.config) {
                            const config = clients.get(ws) || {}
                            clients.set(ws, { ...config, ...data.config })
                            console.log('[WS] 更新客户端配置:', data.config)
                        }
                        break
                    case 'client_upload_start':
                        console.log('[WS] 客户端开始上传全部文件...')
                        break
                    case 'client_upload_complete':
                        console.log('[WS] 客户端上传全部完成')
                        break
                    case 'update':
                        if (data.path && data.content !== undefined) {
                            const targetPath = join(SKINS_DIR, data.path)
                            // 确保父目录存在
                            const parentDir = join(targetPath, '..')
                            await mkdir(parentDir, { recursive: true })

                            // 根据编码类型处理内容
                            if (data.encoding === 'base64') {
                                // Base64 编码的二进制文件
                                const buffer = Buffer.from(data.content, 'base64')
                                await Bun.write(targetPath, buffer)
                            } else {
                                // 文本文件（utf-8 或默认）
                                await Bun.write(targetPath, data.content)
                            }

                            console.log(`[WS] 客户端上传文件: ${data.path}${data.encoding === 'base64' ? ' (binary)' : ''}`)
                        }
                        break
                    case 'create_dir':
                        if (data.path) {
                            const targetPath = join(SKINS_DIR, data.path)
                            await mkdir(targetPath, { recursive: true })
                            console.log(`[WS] 客户端创建目录: ${data.path}`)
                        }
                        break
                    default:
                        console.log('[WS] 收到未知请求:', data)
                        break
                }
            } catch (err) {
                console.error('[WS] 消息解析失败:', err)
            }
        },
        close(ws: ServerWebSocket<unknown>) {
            console.log(`[WS] 客户端断开连接`)
            clients.delete(ws)
        },
    },
})

// 防抖映射，用于防止同一文件的重复事件
const debounceMap = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * 向所有连接的客户端广播消息
 */
function broadcast(data: any) {
    const msg = JSON.stringify(data)
    for (const [client, config] of clients) {
        if (client.readyState === 1) { // WebSocket.OPEN is 1
            // 检查是否应该过滤
            if (data.path && shouldFilterPath(data.path, config)) {
                // 发送跳过日志
                client.send(JSON.stringify({
                    action: 'server_log',
                    path: data.path,
                    status: 'warning',
                    message: '匹配过滤规则，已跳过'
                }))
                console.log(`[WS] 广播: 过滤 -> ${data.path}`)
                continue
            }

            // 如果是文件更新，检查大小限制
            if (data.action === 'update' && data.content && config.maxFileSize) {
                // 估算内容大小 (如果是 base64，实际大小约为 0.75 * length)
                const size = data.content.length
                if (size > config.maxFileSize) {
                    // 发送跳过日志
                    client.send(JSON.stringify({
                        action: 'server_log',
                        path: data.path,
                        status: 'warning',
                        message: `文件过大 (${(size / 1024).toFixed(1)}KB)，已跳过`
                    }))
                    console.log(`[WS] 广播: 文件过大跳过 -> ${data.path}`)
                    continue
                }
            }
            client.send(msg)
        }
    }
}

/**
 * 向指定客户端发送整个目录的内容（上传全部）
 */
async function syncAllFiles(ws: ServerWebSocket<unknown>) {
    console.log('[WS] 开始上传全部...')

    // 发送同步开始消息
    ws.send(JSON.stringify({
        action: 'sync_start',
        path: '',
        content: null,
        isDir: false
    }))

    try {
        // 递归发送整个目录
        await sendDirectoryContents(ws, '', SKINS_DIR)

        // 发送同步完成消息
        ws.send(JSON.stringify({
            action: 'sync_complete',
            path: '',
            content: null,
            isDir: false
        }))

        console.log('[WS] 上传全部完成')
    } catch (err) {
        console.error('[WS] 上传全部失败:', err)
        ws.send(JSON.stringify({
            action: 'sync_error',
            path: '',
            content: (err as Error).message,
            isDir: false
        }))
    }
}

/**
 * 递归向指定客户端发送目录内容
 */
async function sendDirectoryContents(ws: ServerWebSocket<unknown>, relPath: string, absPath: string) {
    try {
        const entries = await readdir(absPath, { withFileTypes: true })

        for (const entry of entries) {
            // 忽略系统文件
            if (entry.name === ".DS_Store") continue

            const entryRelPath = relPath ? join(relPath, entry.name) : entry.name
            const entryAbsPath = join(absPath, entry.name)

            // 获取客户端配置
            const config = clients.get(ws) || {}

            // 检查是否应该过滤
            if (shouldFilterPath(entryRelPath, config)) {
                ws.send(JSON.stringify({
                    action: 'server_log',
                    path: normalizePath(entryRelPath),
                    status: 'warning',
                    message: '匹配过滤规则，已跳过'
                }))
                console.log(`[WS] 广播: 过滤 -> ${entryRelPath}`)
                continue
            }

            if (entry.isDirectory()) {
                // 发送目录创建消息
                ws.send(JSON.stringify({
                    action: "create_dir",
                    path: normalizePath(entryRelPath),
                    content: null,
                    isDir: true
                }))

                // 递归处理子目录
                await sendDirectoryContents(ws, entryRelPath, entryAbsPath)
            } else if (entry.isFile()) {
                // 读取并发送文件内容
                try {
                    const file = Bun.file(entryAbsPath)
                    const size = file.size
                    const config = clients.get(ws)

                    // 检查文件大小
                    if (config?.maxFileSize && size > config.maxFileSize) {
                        ws.send(JSON.stringify({
                            action: 'server_log',
                            path: normalizePath(entryRelPath),
                            status: 'warning',
                            message: `文件过大 (${(size / 1024).toFixed(1)}KB)，已跳过`
                        }))
                        console.log(`[WS] 广播: 文件过大跳过 -> ${entryRelPath}`)
                        continue
                    }

                    const content = await file.text()

                    ws.send(JSON.stringify({
                        action: "update",
                        path: normalizePath(entryRelPath),
                        content,
                        isDir: false
                    }))
                } catch (err) {
                    console.error(`[WS] 读取文件失败 ${entryRelPath}:`, err)
                }
            }
        }
    } catch (err) {
        console.error(`[WS] 读取目录失败 ${relPath}:`, err)
    }
}

/**
 * 递归广播目录内容（用于目录创建/重命名时同步完整内容）
 */
async function broadcastDirectoryContents(relPath: string, absPath: string) {
    try {
        const entries = await readdir(absPath, { withFileTypes: true })

        for (const entry of entries) {
            // 忽略系统文件
            if (entry.name === ".DS_Store") continue

            const entryRelPath = join(relPath, entry.name)
            const entryAbsPath = join(absPath, entry.name)

            if (entry.isDirectory()) {
                // 广播目录创建
                broadcast({
                    action: "create_dir",
                    path: normalizePath(entryRelPath),
                    content: null,
                    isDir: true
                })
                console.log(`[WS] 广播: create_dir -> ${entryRelPath}`)

                // 递归处理子目录
                await broadcastDirectoryContents(entryRelPath, entryAbsPath)
            } else if (entry.isFile()) {
                // 读取并广播文件内容
                try {
                    const file = Bun.file(entryAbsPath)
                    const content = await file.text()

                    broadcast({
                        action: "update",
                        path: normalizePath(entryRelPath),
                        content,
                        isDir: false
                    })
                    console.log(`[WS] 广播: update -> ${entryRelPath}`)
                } catch (err) {
                    console.error(`[WS] 读取文件失败 ${entryRelPath}:`, err)
                }
            }
        }
    } catch (err) {
        console.error(`[WS] 读取目录失败 ${relPath}:`, err)
    }
}

/**
 * 处理文件系统事件
 */
async function handleFileChange(eventType: string, filename: string | null) {
    if (!filename) return

    // 忽略系统文件
    if (filename === ".DS_Store" || filename.endsWith(".DS_Store")) return

    const relPath = filename
    const absPath = join(SKINS_DIR, relPath)

    // 防抖：取消同一文件的重复事件
    const existingTimer = debounceMap.get(relPath)
    if (existingTimer) {
        clearTimeout(existingTimer)
    }

    // 设置新定时器
    debounceMap.set(relPath, setTimeout(async () => {
        debounceMap.delete(relPath)

        try {
            // 检查文件状态
            let action = "update"
            let content: string | null = null
            let isDir = false

            // 先用 stat 检查，因为 Bun.file().exists() 对目录返回 false
            try {
                const stats = await stat(absPath)

                if (stats.isDirectory()) {
                    // 是目录
                    isDir = true
                    action = "create_dir"
                } else {
                    // 是文件
                    const file = Bun.file(absPath)
                    action = "update" // 更新或创建文件
                    content = await file.text()
                }
            } catch (err) {
                // stat 失败说明路径不存在，是删除操作
                action = "delete"
            }

            const payload = {
                action,
                path: normalizePath(relPath),
                content,
                isDir
            }

            console.log(`[WS] 广播: ${action} -> ${relPath}`)
            broadcast(payload)

            // 如果是目录创建，递归广播目录内的所有内容
            if (action === "create_dir") {
                await broadcastDirectoryContents(relPath, absPath)
            }

        } catch (error) {
            console.error(`[WS] 处理 ${relPath} 时出错:`, error)
        }
    }, 100)) // 100ms debounce
}

// 开始监听
try {
    const watcher = watch(SKINS_DIR, { recursive: true }, (event, filename) => {
        handleFileChange(event, filename)
    })
    const shutdown = () => {
        console.log("[WS] 正在关闭服务器...")
        watcher.close()
        server.stop()
        process.exit(0)
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
} catch (error) {
    console.error(`[WS] 启动监听失败:`, error)
}
