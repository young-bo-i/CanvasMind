import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { once } from 'node:events'
import { Writable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { sendGenerationImageDownload, sendMediaDownload } from '../server/generation-records/download'

class TestResponse extends Writable {
  statusCode = 0
  readonly headers = new Map<string, string>()
  readonly chunks: Buffer[] = []

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), String(value))
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }

  body() {
    return Buffer.concat(this.chunks)
  }
}

const createSource = (url: string) => ({
  recordId: 'record-download-test',
  createdAt: new Date('2026-07-24T00:00:00.000Z'),
  url,
  mimeType: 'image/png',
  imageIndex: 0,
})

const createMp4Buffer = () => Buffer.concat([
  Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d,
  ]),
  Buffer.alloc(256, 0x2a),
])

const withMediaServer = async (
  handler: Parameters<typeof createServer>[0],
  run: (url: string) => Promise<void>,
) => {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    await run(`http://127.0.0.1:${address.port}/media`)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

test('原图下载保留 PNG 二进制、MIME 与扩展名', async () => {
  const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvasmind-download-'))
  process.env.UPLOADS_DIR = uploadsDir
  const imageBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00,
  ])
  await fs.writeFile(path.join(uploadsDir, 'original.png'), imageBuffer)

  try {
    const response = new TestResponse()
    await sendGenerationImageDownload(response, createSource('/uploads/original.png'))

    assert.equal(response.statusCode, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.match(response.headers.get('content-disposition') || '', /\.png"$/)
    assert.deepEqual(response.body(), imageBuffer)
  } finally {
    await fs.rm(uploadsDir, { recursive: true, force: true })
  }
})

test('扩展名伪装成图片的 HTML 响应会被拒绝', async () => {
  const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvasmind-download-html-'))
  process.env.UPLOADS_DIR = uploadsDir
  await fs.writeFile(
    path.join(uploadsDir, 'fake.png'),
    '<!doctype html><html><body>not an image</body></html>',
  )

  try {
    const response = new TestResponse()
    await assert.rejects(
      sendGenerationImageDownload(response, createSource('/uploads/fake.png')),
      /返回了网页内容/,
    )
    assert.equal(response.body().length, 0)
  } finally {
    await fs.rm(uploadsDir, { recursive: true, force: true })
  }
})

test('原视频下载保留 MP4 二进制、MIME 与扩展名', async () => {
  const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvasmind-download-video-'))
  process.env.UPLOADS_DIR = uploadsDir
  const videoBuffer = createMp4Buffer()
  await fs.writeFile(path.join(uploadsDir, 'original-video.bin'), videoBuffer)

  try {
    const response = new TestResponse()
    await sendMediaDownload(response, {
      id: 'video-record-download-test',
      createdAt: new Date('2026-07-24T00:00:00.000Z'),
      url: '/uploads/original-video.bin#t=0.1',
      mimeType: 'application/octet-stream',
      mediaKind: 'video',
      mediaIndex: 0,
    })

    assert.equal(response.statusCode, 200)
    assert.equal(response.headers.get('content-type'), 'video/mp4')
    assert.match(response.headers.get('content-disposition') || '', /\.mp4"$/)
    assert.deepEqual(response.body(), videoBuffer)
  } finally {
    await fs.rm(uploadsDir, { recursive: true, force: true })
  }
})

test('远程视频文件头被拆成小块时仍能正确识别并完整回放', async () => {
  const videoBuffer = createMp4Buffer()
  await withMediaServer((_, res) => {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/octet-stream')
    res.write(videoBuffer.subarray(0, 4))
    setTimeout(() => res.end(videoBuffer.subarray(4)), 10)
  }, async (url) => {
    const response = new TestResponse()
    await sendMediaDownload(response, {
      id: 'remote-fragmented-video-test',
      createdAt: new Date('2026-07-24T00:00:00.000Z'),
      url,
      mediaKind: 'video',
    })

    assert.equal(response.headers.get('content-type'), 'video/mp4')
    assert.deepEqual(response.body(), videoBuffer)
  })
})

test('远程压缩响应不转发压缩体长度，避免浏览器截断解压后的媒体', async () => {
  const videoBuffer = createMp4Buffer()
  const compressed = gzipSync(videoBuffer)
  await withMediaServer((_, res) => {
    res.statusCode = 200
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Content-Length', String(compressed.byteLength))
    res.end(compressed)
  }, async (url) => {
    const response = new TestResponse()
    await sendMediaDownload(response, {
      id: 'remote-compressed-video-test',
      createdAt: new Date('2026-07-24T00:00:00.000Z'),
      url,
      mediaKind: 'video',
    })

    assert.equal(response.headers.has('content-length'), false)
    assert.deepEqual(response.body(), videoBuffer)
  })
})

test('媒体类型与文件头不匹配时拒绝下载', async () => {
  const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvasmind-download-mismatch-'))
  process.env.UPLOADS_DIR = uploadsDir
  const imageBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00,
  ])
  await fs.writeFile(path.join(uploadsDir, 'fake-video.mp4'), imageBuffer)

  try {
    const response = new TestResponse()
    await assert.rejects(
      sendMediaDownload(response, {
        id: 'video-mismatch-test',
        createdAt: new Date('2026-07-24T00:00:00.000Z'),
        url: '/uploads/fake-video.mp4',
        mimeType: 'video/mp4',
        mediaKind: 'video',
      }),
      /类型与文件内容不匹配/,
    )
    assert.equal(response.body().length, 0)
  } finally {
    await fs.rm(uploadsDir, { recursive: true, force: true })
  }
})
