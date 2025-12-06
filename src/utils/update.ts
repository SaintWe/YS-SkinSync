import { VERSION } from '../config'
import { log, warn, error } from './log'

const REPO_NAME = 'SaintWe/YS-SkinSync'
const GITHUB_RAW_URL = `https://raw.githubusercontent.com/${REPO_NAME}/main/package.json`
const GITHUB_DIST_BASE = `https://raw.githubusercontent.com/${REPO_NAME}/main/dist`
const CHECK_TIMEOUT = 5000 // 5秒超时
const DOWNLOAD_TIMEOUT = 60000 // 60秒下载超时

/**
 * 比较版本号
 * @returns 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
    const aParts = a.split('.').map(Number)
    const bParts = b.split('.').map(Number)

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aPart = aParts[i] || 0
        const bPart = bParts[i] || 0
        if (aPart > bPart) return 1
        if (aPart < bPart) return -1
    }
    return 0
}

/**
 * 获取当前平台对应的二进制文件名
 */
function getPlatformBinaryName(): string | null {
    const platform = process.platform
    const arch = process.arch

    if (platform === 'linux' && arch === 'x64') return 's11esync-linux-x64'
    if (platform === 'linux' && arch === 'arm64') return 's11esync-linux-arm64'
    if (platform === 'darwin' && arch === 'x64') return 's11esync-darwin-x64'
    if (platform === 'darwin' && arch === 'arm64') return 's11esync-darwin-arm64'
    if (platform === 'win32' && arch === 'x64') return 's11esync-windows-x64.exe'

    return null
}

/**
 * 获取远程版本
 */
async function getRemoteVersion(): Promise<string | null> {
    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT)

        const response = await fetch(GITHUB_RAW_URL, {
            signal: controller.signal
        })
        clearTimeout(timeoutId)

        if (!response.ok) return null

        const packageJson = await response.json() as { version: string }
        return packageJson.version
    } catch {
        return null
    }
}

/**
 * 检查更新
 * @param silent 静默模式，只在有新版本时输出
 */
export async function checkUpdate(silent = false): Promise<void> {
    try {
        const remoteVersion = await getRemoteVersion()

        if (!remoteVersion) {
            if (!silent) {
                warn('检查更新失败: 无法获取远程版本信息')
            }
            return
        }

        const comparison = compareVersions(remoteVersion, VERSION)

        if (comparison > 0) {
            log(`发现新版本: v${remoteVersion} (当前: v${VERSION})`)
            log(`下载地址: https://github.com/${REPO_NAME}/releases`)
        } else if (!silent) {
            log(`当前已是最新版本: v${VERSION}`)
        }
    } catch (err) {
        if ((err as Error).name === 'AbortError') {
            if (!silent) {
                warn('检查更新超时，跳过')
            }
        } else if (!silent) {
            warn('检查更新失败:', (err as Error).message)
        }
    }
}

/**
 * 下载新版本
 */
export async function downloadUpdate(): Promise<void> {
    const binaryName = getPlatformBinaryName()

    if (!binaryName) {
        error(`不支持的平台: ${process.platform}-${process.arch}`)
        return
    }

    log('正在检查版本...')
    const remoteVersion = await getRemoteVersion()

    if (!remoteVersion) {
        error('无法获取远程版本信息')
        return
    }

    const comparison = compareVersions(remoteVersion, VERSION)

    if (comparison <= 0) {
        log(`当前版本 v${VERSION} 已是最新或高于仓库版本 v${remoteVersion}，无需下载`)
        return
    }

    log(`发现新版本: v${remoteVersion}，开始下载...`)

    const downloadUrl = `${GITHUB_DIST_BASE}/${binaryName}`
    const outputPath = `./${binaryName}`

    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)

        const response = await fetch(downloadUrl, {
            signal: controller.signal
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
            error(`下载失败: HTTP ${response.status}`)
            return
        }

        const buffer = await response.arrayBuffer()
        await Bun.write(outputPath, buffer)

        // 设置可执行权限（非 Windows）
        if (process.platform !== 'win32') {
            const { chmod } = await import('fs/promises')
            await chmod(outputPath, 0o755)
        }

        log(`下载完成: ${outputPath}`)
        log(`新版本: v${remoteVersion}`)
    } catch (err) {
        if ((err as Error).name === 'AbortError') {
            error('下载超时')
        } else {
            error('下载失败:', (err as Error).message)
        }
    }
}
