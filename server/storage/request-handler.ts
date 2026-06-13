import { readRawBuffer, sendJson } from '../ai-gateway/shared'
import { requireCurrentSessionUser } from '../auth/session'
import { saveUploadedBuffer } from './service'

// 处理文件上传请求。
export const handleStorageUploadRequest = async (req: any, res: any) => {
  try {
    // 仅允许 POST 上传。
    if (req.method !== 'POST') {
      sendJson(res, 405, {
        message: 'Method Not Allowed',
        error: {
          type: 'storage_upload_error',
          message: 'Method Not Allowed',
        },
      })
      return
    }

    // 安全：上传必须登录(此前匿名可写任意文件，配合同源回显构成存储型 XSS)。
    const sessionUser = await requireCurrentSessionUser(req, res)
    if (!sessionUser?.id) {
      return
    }

    // 读取请求体原始二进制内容。
    const buffer = await readRawBuffer(req)

    // 空文件直接拒绝。
    if (!buffer.byteLength) {
      sendJson(res, 400, {
        message: '上传内容不能为空',
        error: {
          type: 'storage_upload_error',
          message: '上传内容不能为空',
        },
      })
      return
    }

    // 从请求头读取文件名。
    const filename = String(req.headers['x-upload-filename'] || '').trim()

    // 从请求头读取文件 MIME 类型。
    const mimeType = String(req.headers['content-type'] || 'application/octet-stream').trim()

    // 从请求头读取上传分类。
    const category = String(req.headers['x-upload-category'] || 'general').trim()

    // 保存文件到本地上传目录。
    const savedFile = await saveUploadedBuffer({
      buffer,
      filename,
      mimeType,
      category,
    })

    // 返回上传结果。
    sendJson(res, 200, {
      data: savedFile,
      message: '上传成功',
    })
  } catch (error: any) {
    // 请求体超限：返回 413，给前端明确的“文件过大”提示。
    const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 500
    sendJson(res, statusCode, {
      message: error?.message || '文件上传失败',
      error: {
        type: 'storage_upload_error',
        message: error?.message || '文件上传失败',
      },
    })
  }
}
