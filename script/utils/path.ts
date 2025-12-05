/**
 * 检查路径是否应被过滤
 * @param path 文件路径
 * @param filterRegexList 过滤正则表达式列表
 */
export const shouldFilterPath = (path: string, filterRegexList: string[]): boolean => {
    for (const regexStr of filterRegexList) {
        try {
            const regex = new RegExp(regexStr)
            if (regex.test(path)) {
                return true  // 匹配到，需要过滤
            }
        } catch (error) {
            console.error(`无效的正则表达式: ${regexStr}`, error)
        }
    }
    return false  // 不过滤
}
