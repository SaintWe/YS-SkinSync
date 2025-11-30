/// <reference types="bun-types" />
import { watch } from "fs"
import { join, resolve } from "path"
import { type ServerWebSocket, type Server } from "bun"
import { stat, readdir } from "fs/promises"

const PORT = 10080
// 兼容不同的运行环境(Bun 使用 import.meta.dir, Node.js 使用 import.meta.dirname)
const SKINS_DIR = resolve(import.meta.dirname || import.meta.dir || process.cwd(), "skin")

console.log(`[WS] 服务启动中...`)
console.log(`[WS] 监听目录: ${SKINS_DIR}`)
console.log(`[WS] 监听地址: ws://0.0.0.0:${PORT}`)

const clients = new Set<ServerWebSocket<unknown>>()

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
            clients.add(ws)
        },
        message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
            try {
                const msg = typeof message === 'string' ? message : message.toString()
                const data = JSON.parse(msg)
                switch (data.action) {
                    case 'sync_all':
                        console.log('[WS] 收到全量同步请求')
                        // 异步执行全量同步
                        syncAllFiles(ws).catch(err => {
                            console.error('[WS] 全量同步失败:', err)
                        })
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
    for (const client of clients) {
        if (client.readyState === 1) { // WebSocket.OPEN is 1
            client.send(msg)
        }
    }
}

/**
 * 向指定客户端发送整个目录的内容（全量同步）
 */
async function syncAllFiles(ws: ServerWebSocket<unknown>) {
    console.log('[WS] 开始全量同步...')

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

        console.log('[WS] 全量同步完成')
    } catch (err) {
        console.error('[WS] 全量同步失败:', err)
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

            if (entry.isDirectory()) {
                // 发送目录创建消息
                ws.send(JSON.stringify({
                    action: "create_dir",
                    path: entryRelPath,
                    content: null,
                    isDir: true
                }))

                // 递归处理子目录
                await sendDirectoryContents(ws, entryRelPath, entryAbsPath)
            } else if (entry.isFile()) {
                // 读取并发送文件内容
                try {
                    const file = Bun.file(entryAbsPath)
                    const content = await file.text()

                    ws.send(JSON.stringify({
                        action: "update",
                        path: entryRelPath,
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
                    path: entryRelPath,
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
                        path: entryRelPath,
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
                path: relPath,
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
    // recursive: true is supported on macOS
    const watcher = watch(SKINS_DIR, { recursive: true }, (event, filename) => {
        handleFileChange(event, filename)
    })
    process.on("SIGINT", () => {
        console.log("[WS] 正在关闭服务器...")
        watcher.close()
        server.stop()
        process.exit(0)
    })
} catch (error) {
    console.error(`[WS] 启动监听失败:`, error)
}
