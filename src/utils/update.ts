import { VERSION } from '../config'
import { log, warn, error } from './log'

const REPO_NAME = 'SaintWe/F11eSync'
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_NAME}/releases/latest`
const CHECK_TIMEOUT = 5000 // 5秒超时
const DOWNLOAD_TIMEOUT = 120000 // 120秒下载超时

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
function getPlatformBinaryZipName(): string | null {
    const platform = process.platform
    const arch = process.arch

    if (platform === 'linux' && arch === 'x64') return 'f11esync-linux-x64.zip'
    if (platform === 'linux' && arch === 'arm64') return 'f11esync-linux-arm64.zip'
    if (platform === 'darwin' && arch === 'x64') return 'f11esync-darwin-x64.zip'
    if (platform === 'darwin' && arch === 'arm64') return 'f11esync-darwin-arm64.zip'
    if (platform === 'win32' && arch === 'x64') return 'f11esync-windows-x64.zip'

    return null
}

/**
 * 获取最新 Release 信息
 */
async function getLatestRelease(): Promise<{ version: string; assets: { name: string; browser_download_url: string }[] } | null> {
    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT)

        const response = await fetch(GITHUB_API_URL, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'f11esync'
            }
        })
        clearTimeout(timeoutId)

        if (!response.ok) return null

        const release = await response.json() as { tag_name: string; assets: { name: string; browser_download_url: string }[] }
        const version = release.tag_name.replace(/^v/, '')

        return {
            version,
            assets: release.assets
        }
    } catch {
        return null
    }
}

/**
 * 获取远程版本
 */
async function getRemoteVersion(): Promise<string | null> {
    const release = await getLatestRelease()
    return release?.version ?? null
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
            log(`下载地址: https://github.com/${REPO_NAME}/releases/latest`)
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
    const zipName = getPlatformBinaryZipName()

    if (!zipName) {
        error(`不支持的平台: ${process.platform}-${process.arch}`)
        return
    }

    log('正在检查版本...')
    const release = await getLatestRelease()

    if (!release) {
        error('无法获取远程版本信息')
        return
    }

    const comparison = compareVersions(release.version, VERSION)

    if (comparison <= 0) {
        log(`当前版本 v${VERSION} 已是最新或高于远程版本 v${release.version}，无需下载`)
        return
    }

    // 查找对应平台的下载链接
    const asset = release.assets.find(a => a.name === zipName)
    if (!asset) {
        error(`未找到当前平台的下载文件: ${zipName}`)
        return
    }

    log(`发现新版本: v${release.version}，开始下载...`)
    log(`下载地址: ${asset.browser_download_url}`)

    const outputPath = `./${zipName}`

    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)

        const response = await fetch(asset.browser_download_url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'f11esync'
            }
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
            error(`下载失败: HTTP ${response.status}`)
            return
        }

        const buffer = await response.arrayBuffer()
        await Bun.write(outputPath, buffer)

        log(`下载完成: ${outputPath}`)
        log(`新版本: v${release.version}`)
        log(`请解压后替换当前程序`)
    } catch (err) {
        if ((err as Error).name === 'AbortError') {
            error('下载超时')
        } else {
            error('下载失败:', (err as Error).message)
        }
    }
}
