// 图片任务阶段对话的编解码：用现有 content 字段以 [[stageKey]]text 协议持久化，避免额外改表。
// 从 generate.vue 抽出的纯函数(无响应式依赖)，便于复用与单测，并为巨型组件减负。

export interface StageConversationEntry {
  stageKey: string
  text: string
}

// 解析 content 为阶段对话序列。
export const parseStageConversationEntries = (content: string): StageConversationEntry[] => {
  return String(content || '')
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^\[\[(.+?)\]\](.+)$/)
        if (!match) {
          return {
            stageKey: '',
            text: line,
          }
        }
        return {
          stageKey: String(match[1] || '').trim(),
          text: String(match[2] || '').trim(),
        }
      })
      .filter(item => item.text)
}

// 把阶段对话序列化回 content，便于刷新后恢复。
export const stringifyStageConversationEntries = (entries: StageConversationEntry[]) => {
  return entries
      .map(item => item.stageKey ? `[[${item.stageKey}]]${item.text}` : item.text)
      .join('\n')
}
