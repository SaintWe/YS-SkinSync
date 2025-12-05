import { Button, List, Navigation, NavigationStack, Section, Text, TextField, HStack, Toggle } from 'scripting'
import { useState } from 'scripting'
import { getCurrentSettings, saveSettings } from '../utils/skinSync-service'

/**
 * 设置页面组件
 */
export const SettingsPage = () => {
  const dismiss = Navigation.useDismiss()
  const [currentSettings, setCurrentSettings] = useState(() => getCurrentSettings())

  // 更新设置的通用函数
  const updateSettings = (newSettings: any) => {
    setCurrentSettings(newSettings)
    const success = saveSettings(newSettings)
    if (!success) {
      console.error('保存设置失败')
    }
  }

  const removeLineBreaksAndWhitespaces = (str: string) => {
    return str.replace(/\s+/g, '').replace(/\n/g, '')
  }

  const [bookmark, setBookmark] = useState(currentSettings.bookmark ?? '')
  const handleBookmarkChange = (value: string) => {
    const bookmark = removeLineBreaksAndWhitespaces(value)
    setBookmark(bookmark)
    updateSettings({ ...currentSettings, bookmark })
  }

  const [serverUrl, setWsUrl] = useState(currentSettings.serverUrl ?? '')
  const handleWsUrlChange = (value: string) => {
    const serverUrl = removeLineBreaksAndWhitespaces(value)
    setWsUrl(serverUrl)
    updateSettings({ ...currentSettings, serverUrl })
  }

  const [customButtonTitle, setCustomButtonTitle] = useState(currentSettings.customButtonTitle ?? '')
  const handleCustomButtonTitleChange = (value: string) => {
    const customButtonTitle = removeLineBreaksAndWhitespaces(value)
    setCustomButtonTitle(customButtonTitle)
    updateSettings({ ...currentSettings, customButtonTitle })
  }

  const [customButtonUrl, setCustomButtonUrl] = useState(currentSettings.customButtonUrl ?? '')
  const handleCustomButtonUrlChange = (value: string) => {
    const customButtonUrl = removeLineBreaksAndWhitespaces(value)
    setCustomButtonUrl(customButtonUrl)
    updateSettings({ ...currentSettings, customButtonUrl })
  }

  const [pathRegex, setPathRegex] = useState(currentSettings.pathRegex ?? [''])
  const handlePathRegexChange = (value: string, index: number) => {
    const newPathRegex = [...pathRegex.slice(0, index), value, ...pathRegex.slice(index + 1)]
    setPathRegex(newPathRegex)
    const filteredPathRegex = newPathRegex.filter((regex) => regex.trim() !== '')
    updateSettings({ ...currentSettings, pathRegex: filteredPathRegex })
  }
  const handleAddPathRegex = () => {
    setPathRegex([...pathRegex, ''])
  }
  const handleDeletePathRegex = (index: number) => {
    const newPathRegex = [...pathRegex.slice(0, index), ...pathRegex.slice(index + 1)]
    setPathRegex(newPathRegex)
    updateSettings({ ...currentSettings, pathRegex: newPathRegex })
  }

  const [maxFileSize, setMaxFileSize] = useState(currentSettings.maxFileSize ?? 250 * 1024)
  const handleMaxFileSizeChange = (value: number) => {
    setMaxFileSize(value)
    updateSettings({ ...currentSettings, maxFileSize: value })
  }

  const [enableFileSizeLimit, setEnableFileSizeLimit] = useState(currentSettings.enableFileSizeLimit ?? false)
  const handleEnableFileSizeLimitChange = (value: boolean) => {
    setEnableFileSizeLimit(value)
    updateSettings({ ...currentSettings, enableFileSizeLimit: value })
  }

  const [autoConnect, setAutoConnect] = useState(currentSettings.autoConnect ?? false)
  const handleAutoConnectChange = (value: boolean) => {
    setAutoConnect(value)
    updateSettings({ ...currentSettings, autoConnect: value })
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="设置"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          cancellationAction: <Button title="完成" action={dismiss} />
        }}
      >

        <Section
          header={<Text font="headline">目录书签名</Text>}
          footer={
            <Text font="footnote" foregroundStyle="secondaryLabel">
              在应用内『工具 -〉文件书签 -〉添加目录』{"\n"}
              书签名填写在这里，默认同步此目录
            </Text>
          }
        >
          <HStack>
            <TextField
              key={'path'}
              title="目录书签名"
              value={bookmark}
              onChanged={(value) => handleBookmarkChange(value)}
              prompt="请输入目录书签名"
            />
          </HStack>
        </Section>

        <Section
          header={<Text font="headline">HTTP 地址</Text>}
          footer={
            <Text font="footnote" foregroundStyle="secondaryLabel">
              HTTP 地址
            </Text>
          }
        >
          <HStack>
            <TextField
              key={'serverUrl'}
              title="HTTP 地址"
              value={serverUrl}
              onChanged={(value) => handleWsUrlChange(value)}
              prompt="请输入HTTP 地址"
            />
          </HStack>
        </Section>

        <Section
          header={<Text font="headline">自动连接</Text>}
          footer={
            <Text font="footnote" foregroundStyle="secondaryLabel">
              启动脚本后自动连接到服务器
            </Text>
          }
        >
          <Toggle title="启动后自动连接" value={autoConnect} onChanged={handleAutoConnectChange} />
        </Section>

        <Section
          header={<Text font="headline">自定义按钮</Text>}
        >
          <HStack>
            <TextField
              key={'customButtonTitle'}
              title="按钮标题"
              value={customButtonTitle}
              onChanged={(value) => handleCustomButtonTitleChange(value)}
              prompt="请输入按钮标题"
            />
          </HStack>
        </Section>

        <Section
          header={<Text font="headline">自定义按钮URL</Text>}
          footer={
            <Text font="footnote" foregroundStyle="secondaryLabel">
              自定义按钮 URL，点击按钮后打开 app 指定页面
            </Text>
          }
        >
          <HStack>
            <TextField
              key={'customButtonUrl'}
              title="按钮URL"
              value={customButtonUrl}
              onChanged={(value) => handleCustomButtonUrlChange(value)}
              prompt="请输入按钮URL"
              axis="horizontal"
              lineLimit={1}
            />
          </HStack>
        </Section>

        <Section
          header={<Text font="headline">最大文件大小</Text>}
          footer={
            <Text font="footnote" foregroundStyle="secondaryLabel">
              最大文件大小，单位为字节{'\n'}
              超过此大小的文件将被跳过，默认 250kb{'\n'}
              计算方式：250 * 1024 = 256000
            </Text>
          }
        >
          <Toggle title="启用文件大小限制" value={enableFileSizeLimit} onChanged={handleEnableFileSizeLimitChange} />
          <HStack>
            <TextField
              key={'maxFileSize'}
              title="最大文件大小"
              value={maxFileSize.toString()}
              onChanged={(value) => handleMaxFileSizeChange(Number(value))}
              prompt="请输入最大文件大小"
            />
          </HStack>
        </Section>

        <Section
          header={<Text font="headline">过滤文件</Text>}
          footer={
            <Text font="footnote" foregroundStyle="secondaryLabel">
              一行一个，正则表达式，匹配的文件不会被上传或下载{'\n'}
              点击按钮添加行，左滑可删除{'\n'}{'\n'}
              示例：{'\n'}
              • 匹配 .DS_Store 文件：{String.raw`.*\.DS_Store$`}{'\n'}
              注意：反斜杠 \ 用于转义特殊字符
            </Text>
          }
        >
          {pathRegex.map((value, index) => {
            return (
              <HStack
                trailingSwipeActions={{
                  allowsFullSwipe: true,
                  actions: [
                    <Button
                      title="删除"
                      role="destructive"
                      action={() => { handleDeletePathRegex(index) }}
                    />,
                  ]
                }}
              >
                <TextField
                  key={index}
                  title="正则"
                  value={value}
                  onChanged={(value) => handlePathRegexChange(value, index)}
                  prompt="请输入正则"
                  axis="vertical"
                  lineLimit={{ min: 1, max: 4 }}
                />
              </HStack>
            )
          })}
          <Button
            title="添加"
            systemImage="plus"
            action={handleAddPathRegex}
          />
        </Section>

      </List>
    </NavigationStack>
  )
}
