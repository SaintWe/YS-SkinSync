import { HStack, Spacer, Text, VStack } from 'scripting'
import type { SyncLog } from '../types'

type SyncLogListProps = {
    logs: SyncLog[]
}

/**
 * 同步日志列表组件
 */
export const SyncLogList = ({ logs }: SyncLogListProps) => {
    if (logs.length === 0) {
        return (
            <Text font="caption" foregroundStyle="secondaryLabel" padding={10}>
                暂无同步记录
            </Text>
        )
    }

    return (
        <VStack alignment="leading" spacing={5}>
            {logs.map((log, index) => (
                <HStack
                    key={index}
                    spacing={8}
                    padding={8}
                    background={
                        log.status === 'error'
                            ? 'rgba(244, 67, 54, 0.15)'
                            : log.status === 'warning'
                                ? 'rgba(255, 152, 0, 0.15)'
                                : 'rgba(76, 175, 80, 0.15)'
                    }
                    clipShape={{ type: 'rect', cornerRadius: 6 }}
                >
                    <Text font="caption2" foregroundStyle="secondaryLabel" frame={{ width: 50 }}>
                        {log.time}
                    </Text>
                    <VStack alignment="leading" spacing={2}>
                        <HStack spacing={5}>
                            <Text font="caption" bold>
                                {log.status === 'success' ? '✓' : log.status === 'warning' ? '⚠' : '✗'} {log.action}
                            </Text>
                            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                                {log.path}
                            </Text>
                        </HStack>
                        {log.message ? (
                            <Text font="caption2" foregroundStyle={
                                log.status === 'error' ? 'red' : log.status === 'warning' ? 'orange' : 'secondaryLabel'
                            }>
                                {log.message}
                            </Text>
                        ) : <></>}
                    </VStack>
                    <Spacer />
                </HStack>
            ))}
        </VStack>
    )
}
