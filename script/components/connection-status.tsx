import { Button, HStack, Spacer, Text, VStack } from 'scripting'

type ConnectionStatusProps = {
    connected: boolean
    connecting: boolean
    serverUrl: string
    targetPath: string | null
    errorMessage: string
    syncing: boolean
    uploading: boolean
    onConnect: () => void
    onDisconnect: () => void
    onCancelConnect: () => void
    onSyncAll: () => void
    onUploadAll: () => void
}

/**
 * 连接状态组件
 */
export const ConnectionStatus = ({
    connected,
    connecting,
    serverUrl,
    targetPath,
    errorMessage,
    syncing,
    uploading,
    onConnect,
    onDisconnect,
    onCancelConnect,
    onSyncAll,
    onUploadAll
}: ConnectionStatusProps) => {
    return (
        <>
            <HStack spacing={10} padding={10}>
                <Text font="headline">
                    {connected ? '🟢 已连接' : connecting ? '🟡 连接中...' : '🔴 未连接'}
                </Text>
                <Spacer />
                <Text font="headline" foregroundStyle="secondaryLabel">
                    {serverUrl}
                </Text>
            </HStack>

            {targetPath ? (
                <VStack alignment="center" spacing={5}>
                    <Text font="headline" foregroundStyle="secondaryLabel">
                        目标路径: {targetPath}
                    </Text>
                </VStack>
            ) : <></>}

            {errorMessage ? (
                <VStack padding={10} background="#ffebee" clipShape={{ type: 'rect', cornerRadius: 8 }}>
                    <Text font="caption" foregroundStyle="#c62828">
                        ⚠️ {errorMessage}
                    </Text>
                </VStack>
            ) : <></>}

            <HStack spacing={10} padding={10}>
                {!connected && !connecting ? (
                    <Button
                        key="connect"
                        title="连接服务器"
                        action={onConnect}
                        buttonStyle="borderedProminent"
                    />
                ) : <></>}
                {connecting ? (
                    <Button
                        key="cancel"
                        title="取消连接"
                        action={onCancelConnect}
                        buttonStyle="bordered"
                    />
                ) : <></>}
                {connected ? (
                    <>
                        <Button
                            key="disconnect"
                            title="断开连接"
                            action={onDisconnect}
                            buttonStyle="bordered"
                        />
                        <Spacer />
                        <Button
                            key="sync"
                            title={syncing ? "下载中..." : "下载全部"}
                            action={onSyncAll}
                            buttonStyle="bordered"
                            disabled={syncing || uploading}
                        />
                        <Spacer />
                        <Button
                            key="upload"
                            title={uploading ? "上传中..." : "上传全部"}
                            action={onUploadAll}
                            buttonStyle="bordered"
                            disabled={syncing || uploading}
                        />
                    </>
                ) : <></>}
            </HStack>
        </>
    )
}
