# 元书输入法皮肤同步工具

一个基于 **Scripting** 应用的元书输入法皮肤同步工具，工具将监听 `./skin` 目录下的文件变化，当文件变化时，工具会自动将文件发送给 Scripting。

## 🚀 快速开始

### 环境要求

- iOS 设备
- [Scripting](https://apps.apple.com/app/scripting/id1471239139) 应用
- [Bun](https://bun.com) (用于开发环境)

### 安装 Bun

[前往 https://bun.com 查看安装方法](https://bun.com)

### 安装依赖

你需要先安装 Bun，然后在项目目录下运行以下命令安装依赖：

```bash
bun i
```

### 启动文件同步

在项目目录下运行以下命令启动文件同步：

```bash
bun ws.ts     # 启动文件同步
```

### 皮肤文件在哪

你的皮肤文件放在项目的 `./skin` 目录下

### 在 Scripting 中使用

1. [点击导入 script.zip](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2FSaintWe%2FYS-SkinSync%2Fraw%2Frefs%2Fheads%2Fmain%2Fscript.zip%22%5D) 到 Scripting 中

2. 在 Scripting 的【工具】->【文件书签】中右上角加号添加目录书签，目录指向你的皮肤文件夹(能看到 config 的位置)，设置一个你喜欢的名称

3. 点击运行【皮肤ws同步】脚本，在脚本设置中填入你上一步创建的文件书签名称以及修改 WebSocket 地址中的 IP 改为你的电脑 IP

4. 点击连接服务器，即可开始同步，此时你在电脑端修改的皮肤文件会自动同步到手机端

5. 修改完成后点击前往元书可自动进入皮肤界面

## 答疑解惑

**Q: Scripting 未连接服务器能否同步？**

A: 不能，Scripting 需要连接服务器才能同步。

**Q: 如果我在同步工具启动前修改了皮肤文件？**

A: 启动同步工具后，并不会将启动前你修改的文件发送给 Scripting，你可以在 Scripting 中点击连接服务器后点击下载全部。

**Q: 如果手机端存在文件 A，电脑端不存在文件 A，那么？**

A: 除非你在 Scripting 中上传全部，否则电脑端不会有文件 A。

**Q: 是否适用于仓输入法？**

A: 可以，你甚至可以同步给手机任意文件夹。

**Q: 为什么持续同步失败？**

A: 系统可能会清理文件书签，持续发生这种问题可以在 Scripting 的文件书签中重新添加文件书签。

**Q: 能否发送大文件？**

A: 不能，当前未使用流式传输，最大只支持 200kb 以内的文件，发送大文件可能导致 Scripting 崩溃，如果需要发送大文件，可以考虑使用其他方式。

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。
