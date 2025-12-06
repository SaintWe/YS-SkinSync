/**
 * 此文件用于监控 script 文件夹的变化
 * 并将变化同步到 iCloud 的 Scripting 脚本文件夹
 */
import chokidar from 'chokidar'
import fs from 'fs-extra'
import { homedir } from 'os'
import path from 'path'

type WatchEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir' | 'ready' | 'error' | 'raw' | 'all'

// 配置路径
const devPath = path.join(
  homedir(),
  'Library',
  'Mobile Documents',
  'iCloud~com~thomfang~Scripting',
  'Documents',
  'scripts',
  'F11eSync'
)

const srcDir = path.resolve('script')
const destDir = path.resolve(devPath)

fs.ensureDirSync(destDir)

console.log(`🚀 开始监控: ${srcDir}`)
console.log(`📂 同步到: ${destDir}\n`)

const watcher = chokidar.watch(srcDir, {
  ignored: /(^|[/\\])\../, // 忽略隐藏文件
  ignoreInitial: false,
  persistent: true
})

// 处理文件和目录事件
watcher.on('all', (event: WatchEvent, filePath: string) => {
  const relativePath = path.relative(srcDir, filePath)
  const targetPath = path.join(destDir, relativePath)

  switch (event) {
    case 'add':
    case 'change':
      fs.copy(filePath, targetPath, { overwrite: true })
        .then(() => console.log(`✅ 文件更新: ${relativePath}`))
        .catch(err => console.error(`❌ 复制失败: ${err}`))
      break

    case 'addDir':
      if (!relativePath) break
      fs.ensureDir(targetPath)
        .then(() => console.log(`📁 目录创建: ${relativePath}`))
        .catch(err => console.error(`❌ 创建目录失败: ${err}`))
      break

    case 'unlink':
      fs.remove(targetPath)
        .then(() => console.log(`🗑 文件删除: ${relativePath}`))
        .catch(err => console.error(`❌ 删除失败: ${err}`))
      break

    case 'unlinkDir':
      fs.remove(targetPath)
        .then(() => console.log(`🗑 目录删除: ${relativePath}`))
        .catch(err => console.error(`❌ 删除目录失败: ${err}`))
      break
  }
})

watcher.on('error', error => {
  console.error(`❌ 监控错误: ${error}`)
})

const shutdown = () => {
  watcher.close().then(() => {
    console.log('✅ 监控已关闭')
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
