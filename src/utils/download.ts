export interface TriggerDownloadOptions {
  downloadName?: string
}

// 统一用临时链接导航到服务端 attachment 响应。
// 服务端负责 Content-Disposition，因而 API 与页面跨域时也不依赖浏览器的跨域 download 属性。
export const triggerBrowserDownload = (
  downloadUrl: string,
  options: TriggerDownloadOptions = {},
) => {
  const normalizedUrl = String(downloadUrl || '').trim()
  if (!normalizedUrl || typeof document === 'undefined') {
    return false
  }

  const anchor = document.createElement('a')
  anchor.href = normalizedUrl
  anchor.download = options.downloadName || ''
  anchor.rel = 'noopener'
  anchor.target = '_blank'
  anchor.style.display = 'none'
  try {
    document.body.appendChild(anchor)
    anchor.click()
    return true
  } catch {
    return false
  } finally {
    anchor.remove()
  }
}

// 批量入口逐项触发同一个受保护下载接口。浏览器可能首次询问“允许多个文件下载”，
// 因此调用方需给出明确提示；每个文件仍独立流式传输，不在前端聚合占用内存。
export const triggerBrowserDownloads = (downloadUrls: string[]) => {
  return downloadUrls.reduce((count, url) => (
    triggerBrowserDownload(url) ? count + 1 : count
  ), 0)
}
