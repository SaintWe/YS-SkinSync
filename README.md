# F11eSync

一个基于 **Scripting** 应用的文件同步工具，工具将监听指定目录下的文件，当文件变化时，工具会自动将文件发送给 Scripting。

## 🚀 快速使用

### Windows

1. [点击下载](https://github.com/SaintWe/F11eSync/releases/latest/download/f11esync-windows-x64.zip) 程序，解压后运行 `f11esync-windows-x64.exe` 即可
2. 继续后续的步骤

### macOS / Linux

根据你的平台下载对应的二进制文件
 
- macOS-x64: [点击下载](https://github.com/SaintWe/F11eSync/releases/latest/download/f11esync-darwin-x64.zip)，Intel
- macOS-arm64: [点击下载](https://github.com/SaintWe/F11eSync/releases/latest/download/f11esync-darwin-arm64.zip)，Apple M 系列
- Linux-x64: [点击下载](https://github.com/SaintWe/F11eSync/releases/latest/download/f11esync-linux-x64.zip)
- Linux-arm64: [点击下载](https://github.com/SaintWe/F11eSync/releases/latest/download/f11esync-linux-arm64.zip)

1. 下载后解压，运行 `f11esync-xxx` 即可，以解压后文件名为准
2. 继续后续的步骤

### 后续步骤

1. iPhone 上安装 [Scripting](https://apps.apple.com/app/scripting/id1471239139) 应用
2. 点击 [导入 script.zip](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2FSaintWe%2FF11eSync%2Freleases%2Flatest%2Fdownload%2Fscript.zip%22%5D) 到 Scripting 中
3. 在 Scripting 的【工具】->【文件书签】中右上角加号添加目录书签，目录指向你想同步的文件夹，设置一个你喜欢的名称
4. 点击运行【F11eSync】脚本，在脚本设置中填入你上一步创建的文件书签名称以及修改 HTTP 地址中的 IP 改为你的电脑 IP
5. 点击连接服务器，即可开始同步，此时你在电脑端修改的文件会自动同步到手机端
6. 修改完成后点击自定义按钮可跳转到你设定的 APP 中

## 开发文档

### 环境要求

- iOS 设备
- [Scripting](https://apps.apple.com/app/scripting/id1471239139) 应用
- [Bun](https://bun.com) (用于开发环境)

### 安装依赖

```bash
bun i
```

### 启动脚本开发同步

```bash
bun watch.ts     # 启动脚本开发同步，默认目录是 macOS 的 iCloud，Windows 你需要手动修改源码
```

## 更新日志

### 服务端

#### v1.2.1

- 已编译二进制文件，支持 Linux、macOS、Windows-x64 (不支持 x86)
- 二进制运行需要指定同步目录，例如：`./f11esync-linux-x64 -d ./skin`

#### v1.2.0

- 从 WebSocket 迁移到 Socket.IO，提升连接稳定性
- 配置项 `wsUrl` 改为 `serverUrl`，使用 HTTP 协议

#### v1.1.0

- 新增分片传输，支持传输大文件，服务端与客户端需要更新

### 客户端

#### v1.1.3

- 从 WebSocket 迁移到 Socket.IO，提升连接稳定性
- 配置项 `wsUrl` 改为 `serverUrl`，使用 HTTP 协议

#### v1.1.0

- 新增分片传输，支持传输大文件，服务端与客户端需要更新

## 答疑解惑

**Q: Scripting 未连接服务器能否同步？**

A: 不能，Scripting 需要连接服务器才能同步。

**Q: 如果我在同步工具启动前修改了文件？**

A: 启动同步工具后，并不会将启动前你修改的文件发送给 Scripting，你可以在 Scripting 中点击连接服务器后点击下载全部。

**Q: 如果手机端存在文件 A，电脑端不存在文件 A，那么？**

A: 除非你在 Scripting 中上传全部，否则电脑端不会有文件 A。

**Q: 是否适用于仓输入法？**

A: 可以，你甚至可以同步给手机任意文件夹。

**Q: 为什么持续同步失败？**

A: 在你同步的 APP 更新后目录会发生变化，请重新添加文件书签。

**Q: 能否发送大文件？**

A: 以使用分片传输，客户端以及服务端使用 v1.1.0 版本后可以传输大文件。

**Q: 如何更新？**

A: Scripting 长按脚本可以更新，服务端的话请重新下载二进制文件即可。

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。
