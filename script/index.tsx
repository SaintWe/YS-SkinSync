import { Button, HStack, List, Navigation, NavigationStack, Script, Section, Spacer, Text, VStack } from 'scripting'
import { useEffect, useRef, useState } from 'scripting'
import { SettingsPage } from './components/settings-page'
import { SyncLogList } from './components/sync-log-list'
import { ConnectionStatus } from './components/connection-status'
import { getCurrentSettings } from './utils'
import { useSyncLogs } from './hooks'
import type { FileChangeEvent, ChunkReceiveState, ChunkAckWaiter } from './types'
import { handleFileSync, uploadAllFiles, createSocketConnection, disconnectSocket, cancelSocketConnect, requestSyncAll, getSocket } from './services'
import { version } from './script.json'

/**
 * 主页面
 */
const Main = () => {
  const dismiss = Navigation.useDismiss()

  // 状态管理
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [targetPath, setTargetPath] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [settings, setSettings] = useState(getCurrentSettings())

  // Refs
  const socketRef = useRef<SocketIOClient | null>(null)
  const targetPathRef = useRef<string | null>(null)
  const uploadingRef = useRef(false)
  const chunkReceiveStateRef = useRef(new Map<string, ChunkReceiveState>())
  const chunkAckWaitersRef = useRef(new Map<string, ChunkAckWaiter>())

  // 日志管理
  const { logs, addLog, clearLogs, cleanup, timerRef } = useSyncLogs()

  // 处理文件同步事件
  const onMessage = async (event: FileChangeEvent) => {
    await handleFileSync(event, {
      uploadingRef,
      targetPathRef,
      socketRef,
      chunkReceiveStateRef,
      chunkAckWaitersRef,
      settings,
      addLog,
      setSyncing,
      setUploading
    })
  }

  // 连接
  const connect = () => {
    if (connected || connecting) return
    createSocketConnection({
      serverUrl: settings.serverUrl,
      bookmark: settings.bookmark,
      settings,
      onMessage,
      addLog,
      setConnected,
      setConnecting,
      setErrorMessage,
      setTargetPath,
      targetPathRef,
      socketRef
    })
  }

  // 断开
  const disconnect = () => {
    disconnectSocket(socketRef, addLog)
    setConnected(false)
    setConnecting(false)
  }

  // 取消连接
  const cancelConnect = () => {
    cancelSocketConnect(socketRef, setConnecting, setConnected, addLog)
  }

  // 下载全部
  const syncAll = () => {
    requestSyncAll(socketRef, connected, setErrorMessage, addLog)
  }

  // 上传全部
  const uploadAll = async () => {
    await uploadAllFiles({
      socketRef,
      targetPathRef,
      chunkAckWaitersRef,
      settings,
      addLog,
      setUploading,
      uploadingRef,
      setErrorMessage,
      connected
    })
  }

  // 组件卸载清理
  useEffect(() => {
    return () => {
      cleanup()
      disconnect()
    }
  }, [])

  // 自动连接
  useEffect(() => {
    if (settings.autoConnect) {
      const timer = setTimeout(connect, 500)
      return () => clearTimeout(timer)
    }
  }, [])

  const [showManualSheet, setShowManualSheet] = useState(false)
  const [showSettingsSheet, setShowSettingsSheet] = useState(false)

  // 设置页面关闭时刷新
  useEffect(() => {
    if (!showSettingsSheet) {
      const newSettings = getCurrentSettings()
      setSettings(newSettings)
      // 如果已连接，发送新配置
      const socket = getSocket()
      if (socket && connected) {
        socket.emit('configure', {
          enableFileSizeLimit: newSettings.enableFileSizeLimit,
          maxFileSize: newSettings.maxFileSize,
          pathRegex: newSettings.pathRegex
        })
      }
    }
  }, [showSettingsSheet])

  return (
    <NavigationStack>
      <List
        navigationTitle={`F11eSync v${version}`}
        navigationBarTitleDisplayMode="large"
        sheet={{
          isPresented: showManualSheet,
          onChanged: setShowManualSheet,
          content: (
            <VStack presentationDragIndicator="visible" presentationDetents={[800, 'medium', 'large']} spacing={20} padding={20}>
              <Text font="headline">1. 创建文件书签</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                在"文件书签"工具中创建一个书签，指向要同步的目标目录
              </Text>
              <Text font="headline">2. 设置服务器地址和文件书签</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                在设置中设置服务器地址以及"文件书签"工具创建的书签名
              </Text>
              <Text font="headline">3. 启动服务器</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                在 PC/MAC 端的终端运行服务端，详情查看 GitHub
              </Text>
              <Text font="headline">4. 连接服务器</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                点击"连接服务器"按钮建立连接
              </Text>
              <Text font="headline">5. 自动同步</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                PC/MAC 端监控的指定目录中的文件变更会自动同步到 Scripting
              </Text>
              <Text font="headline">6. 通过自定义按钮执行操作</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                点击自定义按钮可跳转到你设定的 APP 中
              </Text>
            </VStack>
          )
        }}
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
          primaryAction: (
            <Button
              title="设置"
              action={async () => {
                setShowSettingsSheet(true)
                await Navigation.present({
                  element: <SettingsPage />,
                  modalPresentationStyle: 'pageSheet'
                })
                setShowSettingsSheet(false)
              }}
            />
          ),
          topBarTrailing: [
            <Button
              key="github"
              title="GitHub"
              action={() => { Safari.openURL('https://github.com/SaintWe/F11eSync') }}
            />,
            <Button
              key="tutorial"
              title="使用教程"
              action={() => setShowManualSheet(true)}
            />
          ]
        }}
      >
        {/* 连接状态 */}
        <Section header={<Text font="headline">连接状态</Text>}>
          <ConnectionStatus
            connected={connected}
            connecting={connecting}
            serverUrl={settings.serverUrl}
            targetPath={targetPath}
            errorMessage={errorMessage}
            syncing={syncing}
            uploading={uploading}
            onConnect={connect}
            onDisconnect={disconnect}
            onCancelConnect={cancelConnect}
            onSyncAll={syncAll}
            onUploadAll={uploadAll}
          />
        </Section>

        <Section>
          <Button
            key="open"
            title={settings.customButtonTitle || '未设定，请先设定按钮动作'}
            action={() => {
              disconnect()
              Safari.openURL(settings.customButtonUrl || '')
            }}
            buttonStyle="automatic"
          />
        </Section>

        {/* 同步日志 */}
        <Section
          header={
            <HStack>
              <Text font="headline">同步日志</Text>
              {logs.length > 0 ? (
                <>
                  <Spacer />
                  <Button title="清空" action={clearLogs} buttonStyle="automatic" />
                </>
              ) : <></>}
            </HStack>
          }
        >
          <SyncLogList logs={logs} />
        </Section>
      </List>
    </NavigationStack>
  )
}

/**
 * 主函数
 */
const run = async (): Promise<void> => {
  await Navigation.present({
    element: <Main />,
    modalPresentationStyle: 'pageSheet'
  })
  Script.exit()
}

run()
