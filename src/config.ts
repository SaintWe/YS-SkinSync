import { program } from 'commander'
import { resolve } from 'path'
import { writeFileSync } from 'fs'
import { version } from '../package.json'
import { error } from './utils'

// 判断是否为编译后的二进制运行
const isCompiledBinary = !process.execPath.toLowerCase().includes('bun')

// 解析命令行参数
program
    .option('-p, --port <number>', '端口号', '10080')
    .option('-H, --host <string>', '主机地址', '0.0.0.0')
    .option('-d, --dir <path>', '监听目录')
    .option('-u, --update', '检查更新')
    .option('-D, --download', '下载新版本')
    .parse()

const opts = program.opts()

export const CHECK_UPDATE_ONLY = opts.update as boolean
export const DOWNLOAD_UPDATE = opts.download as boolean

// 二进制模式必须指定目录
if (isCompiledBinary && !opts.dir && !CHECK_UPDATE_ONLY && !DOWNLOAD_UPDATE) {
    const platform = process.platform

    // Windows 下生成启动脚本
    if (platform === 'win32') {
        const exeName = process.execPath.split(/[/\\]/).pop() || 'f11esync-windows-x64.exe'
        const batContent = `@echo off
chcp 65001 >nul
echo F11eSync 文件同步服务器
echo.

REM 请将下面的路径修改为你要同步的目录（默认为当前目录下的 sync 文件夹）
REM 例如: set SYNC_DIR=D:\\我的文件\\皮肤
set SYNC_DIR=%~dp0sync

echo 正在启动服务器，同步目录: %SYNC_DIR%
echo.
${exeName} -d "%SYNC_DIR%"
pause
`.replace(/\n/g, '\r\n')  // 使用 Windows CRLF 换行符
        const batPath = '启动脚本.bat'

        try {
            writeFileSync(batPath, batContent, 'utf-8')
            console.log('[F11eSync] 未指定同步目录')
            console.log('')
            console.log('已生成 "启动脚本.bat" 文件')
            console.log('请用记事本打开并修改 SYNC_DIR 为你要同步的目录路径')
            console.log('然后双击运行 "启动脚本.bat" 即可')
            console.log('')
        } catch (e) {
            console.log('[F11eSync] 错误：未指定同步目录')
            console.log('用法：f11esync.exe -d C:\\path\\to\\folder')
            console.log('')
        }

        // 使用 Bun.sleep 代替 readline，简单等待几秒
        console.log('3 秒后自动退出...')
        await Bun.sleep(3000)
        process.exit(1)
    } else {
        error('错误：未指定同步目录，必须使用 -d 参数指定同步目录')
        error('用法：./f11esync -d /path/to/skin')
        process.exit(1)
    }
}

// 源码模式使用默认目录
const skinDir = opts.dir ? resolve(opts.dir as string) : resolve(process.cwd(), 'skin')

export const VERSION = version
export const HOST = opts.host as string
export const PORT = parseInt(opts.port, 10)
export const SKIN_DIR = skinDir
export const ADDRESS = `http://${HOST}:${PORT}`
