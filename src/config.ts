import { program } from 'commander'
import { resolve } from 'path'
import { version } from '../package.json'

// 解析命令行参数
program
    .option('-p, --port <number>', '端口号', '10080')
    .option('-H, --host <string>', '主机地址', '0.0.0.0')
    .option('-d, --dir <path>', '监听目录', resolve(process.cwd(), 'skin'))
    .parse()

const opts = program.opts()

export const VERSION = version
export const HOST = opts.host as string
export const PORT = parseInt(opts.port, 10)
export const SKIN_DIR = resolve(opts.dir as string)
export const ADDRESS = `ws://${HOST}:${PORT}`
