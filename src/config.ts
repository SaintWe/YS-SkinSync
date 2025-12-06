import { program } from 'commander'
import { resolve } from 'path'
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
    error('错误：未指定同步目录，必须使用 -d 参数指定同步目录')
    const platform = process.platform
    if (platform === 'win32') {
        error('用法：s11esync.exe -d C:\\path\\to\\skin')
    } else {
        error('用法：./s11esync -d /path/to/skin')
    }
    process.exit(1)
}

// 源码模式使用默认目录
const skinDir = opts.dir ? resolve(opts.dir as string) : resolve(process.cwd(), 'skin')

export const VERSION = version
export const HOST = opts.host as string
export const PORT = parseInt(opts.port, 10)
export const SKIN_DIR = skinDir
export const ADDRESS = `http://${HOST}:${PORT}`
