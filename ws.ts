/// <reference types="bun-types" />
import { watch } from "fs"
import { join, resolve } from "path"
import { type ServerWebSocket, type Server } from "bun"
import { stat, readdir, mkdir } from "fs/promises"

const HOST = "0.0.0.0"
const PORT = 10080
// 兼容不同的运行环境(Bun 使用 import.meta.dir, Node.js 使用 import.meta.dirname)
const SKIN_DIR = resolve(import.meta.dirname || import.meta.dir || process.cwd(), "skin")
const ADDRESS = `ws://${HOST}:${PORT}`

console.log(`[WS] 服务启动中...`)
console.log(`[WS] 监听目录: ${SKIN_DIR}`)
console.log(`[WS] 监听地址: ${ADDRESS}`)

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
    hostname: HOST,
    port: PORT,
    fetch(req: Request, server: Server<unknown>) {
        // Upgrade to WebSocket
        if (server.upgrade(req, { data: {} })) {
            return
        }
        return new Response(`正在监听 skin 目录，请通过 ${ADDRESS} 连接`, { status: 200 })
    },
    websocket: {
        open(ws: ServerWebSocket<unknown>) {
            if (clients.size > 0) {
                console.log(`[WS] 客户端连接失败，已存在连接的客户端，不允许多个客户端连接`)
                ws.close()
                return
            }
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
                        syncAllFiles(ws, clients.get(ws) || {}).catch(err => {
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
                            const targetPath = join(SKIN_DIR, data.path)
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
                            const targetPath = join(SKIN_DIR, data.path)
                            try {
                                // 检查目录是否已存在
                                await stat(targetPath)
                                console.log(`[WS] 目录已存在或存在同名文件，跳过创建: ${data.path}`)
                            } catch {
                                await mkdir(targetPath, { recursive: true })
                                console.log(`[WS] 客户端创建目录: ${data.path}`)
                            }
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

/**
 * 验证文件大小
 */
function validateFileSize(size: number, config: ClientConfig): { valid: boolean, reason?: string } {
    if (config.maxFileSize && size > config.maxFileSize) {
        return { valid: false, reason: `文件过大 (${(size / 1024).toFixed(1)}KB)，已跳过` }
    }
    return { valid: true }
}

/**
 * 验证路径过滤规则
 */
function validatePath(path: string, config: ClientConfig): { valid: boolean, reason?: string } {
    // 1. 检查过滤规则
    if (shouldFilterPath(path, config)) {
        return { valid: false, reason: '匹配过滤规则，已跳过' }
    }
    return { valid: true }
}

// 防抖映射，用于防止同一文件的重复事件
const debounceMap = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * 向指定客户端发送数据
 */
function sendToClientJson(ws: ServerWebSocket<unknown>, data: any) {
    if (ws.readyState !== 1) return
    ws.send(JSON.stringify(data))
}

/**
 * 向指定客户端发送警告消息
 */
function sendToClientWarning(ws: ServerWebSocket<unknown>, title: string, message: string) {
    sendToClientJson(ws, { action: 'server_log', path: title, status: 'warning', message })
}

/**
 * 向指定客户端发送整个目录的内容（上传全部）
 */
async function syncAllFiles(ws: ServerWebSocket<unknown>, config: ClientConfig) {
    console.log('[WS] 开始上传全部...')

    // 发送同步开始消息
    sendToClientJson(ws, { action: 'sync_start', path: '', content: null, isDir: false })

    try {
        // 递归发送整个目录
        await broadcastDirectoryContents(ws, config, '', SKIN_DIR)

        // 发送同步完成消息
        sendToClientJson(ws, {
            action: 'sync_complete',
            path: '',
            content: null,
            isDir: false
        })

        console.log('[WS] 上传全部完成')
    } catch (err) {
        console.error('[WS] 上传全部失败:', err)
        sendToClientJson(ws, {
            action: 'sync_error',
            path: '',
            content: (err as Error).message,
            isDir: false
        })
    }
}

/**
 * 处理文件系统条目
 */
async function processEntry(
    ws: ServerWebSocket<unknown>,
    config: ClientConfig,
    relPath: string,
    absPath: string,
    isDir: boolean,
    recurse: (rel: string, abs: string) => Promise<void>,
) {
    const normalizedRelPath = normalizePath(relPath)

    // 验证路径
    const validation = validatePath(normalizedRelPath, config)
    if (!validation.valid) {
        const action = isDir ? "create_dir" : "update"
        const title = `${action} -> ${normalizedRelPath}`
        const message = validation.reason || '路径验证失败'
        sendToClientWarning(ws, title, message)
        console.log(`[WS] ${message}: ${title}`)
        return
    }

    if (isDir) {
        sendToClientJson(ws, { action: "create_dir", path: normalizedRelPath, content: null, isDir: true })
        console.log(`[WS] 广播: create_dir -> ${normalizedRelPath}`)
        // 递归处理子目录
        await recurse(relPath, absPath)
    } else {
        try {
            const file = Bun.file(absPath)
            const size = file.size
            // 验证文件大小
            const validation = validateFileSize(size, config)
            if (!validation.valid) {
                sendToClientWarning(ws, normalizedRelPath, validation.reason || '文件大小验证失败')
                console.log(`[WS] 文件过大，跳过 -> ${normalizedRelPath} (${validation.reason})`)
                return
            }
            const content = await file.text()
            sendToClientJson(ws, {
                action: "update",
                path: normalizedRelPath,
                content,
                isDir: false
            })
            console.log(`[WS] 广播: update -> ${normalizedRelPath}`)
        } catch (err) {
            console.error(`[WS] 读取文件失败 ${normalizedRelPath}:`, err)
        }
    }
}

/**
 * 广播文件更新
 */
async function broadcastFileUpdate(ws: ServerWebSocket<unknown>, config: ClientConfig, relPath: string, absPath: string, isDir: boolean) {
    await processEntry(
        ws,
        config,
        relPath,
        absPath,
        isDir,
        (rel, abs) => broadcastDirectoryContents(ws, config, rel, abs),
    )
}

/**
 * 递归广播目录内容（用于目录创建/重命名时同步完整内容）
 */
async function broadcastDirectoryContents(ws: ServerWebSocket<unknown>, config: ClientConfig, relPath: string, absPath: string) {
    try {
        const entries = await readdir(absPath, { withFileTypes: true })
        for (const entry of entries) {
            // 忽略系统文件
            if (entry.name === ".DS_Store") continue
            const entryRelPath = relPath ? join(relPath, entry.name) : entry.name
            const entryAbsPath = join(absPath, entry.name)
            await broadcastFileUpdate(ws, config, entryRelPath, entryAbsPath, entry.isDirectory())
        }
    } catch (err) {
        console.error(`[WS] 读取目录失败 ${relPath}:`, err)
    }
}

/**
 * 向指定客户端发送删除广播
 */
function sendToClientDelete(ws: ServerWebSocket<unknown>, config: ClientConfig, data: any) {
    const validation = validatePath(data.path, config)
    if (!validation.valid) {
        const action = data.action
        const title = `${action} -> ${data.path}`
        const message = validation.reason || '路径验证失败'
        sendToClientWarning(ws, title, message)
        console.log(`[WS] ${message}: ${title}`)
        return
    }
    sendToClientJson(ws, data)
    console.log(`[WS] 广播: ${data.action} -> ${data.path}`)
}

/**
 * 处理文件系统事件
 */
async function handleFileChange(eventType: string, filename: string | null) {
    if (!filename) return

    // 忽略系统文件
    if (filename === ".DS_Store" || filename.endsWith(".DS_Store")) return

    const relPath = filename
    const absPath = join(SKIN_DIR, relPath)

    // 防抖：取消同一文件的重复事件
    const existingTimer = debounceMap.get(relPath)
    if (existingTimer) {
        clearTimeout(existingTimer)
    }

    // 设置新定时器
    debounceMap.set(relPath, setTimeout(async () => {
        debounceMap.delete(relPath)

        const ws = clients.keys().next().value
        if (!ws) return
        const config = clients.get(ws) || {}

        try {
            // 检查文件状态
            let action = "update"
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
                    action = "update"
                }

                await broadcastFileUpdate(ws, config, relPath, absPath, isDir)

            } catch (err) {
                // stat 失败说明路径不存在，是删除操作
                action = "delete"

                const payload = {
                    action,
                    path: normalizePath(relPath),
                    content: null,
                    isDir: false
                }

                sendToClientDelete(ws, config, payload)
            }

        } catch (error) {
            console.error(`[WS] 处理 ${relPath} 时出错:`, error)
        }
    }, 100)) // 100ms debounce
}

// 开始监听
try {
    const watcher = watch(SKIN_DIR, { recursive: true }, (event, filename) => {
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
