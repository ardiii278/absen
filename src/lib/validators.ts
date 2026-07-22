import { z } from 'zod'

export function isValidImageSignature(buffer: Buffer): boolean {
  if (buffer.length < 4) return false
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return true
  }
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return true
  }
  return false
}

// 5MB limit
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

export const base64ImageSchema = z.string().refine((val) => {
  if (!val) return false
  // Regex to check basic base64 characters
  const base64Regex = /^[A-Za-z0-9+/=]+$/
  // Strip whitespace if any
  const cleanVal = val.replace(/\s/g, '')
  if (!base64Regex.test(cleanVal)) return false

  // Estimate size in bytes
  const padding = (cleanVal.endsWith('==') ? 2 : cleanVal.endsWith('=') ? 1 : 0)
  const sizeInBytes = (cleanVal.length * 3) / 4 - padding
  if (sizeInBytes > MAX_IMAGE_SIZE) return false

  try {
    const buffer = Buffer.from(cleanVal, 'base64')
    return isValidImageSignature(buffer)
  } catch {
    return false
  }
}, {
  message: 'Foto harus berformat JPEG/PNG yang valid dan berukuran maksimal 5MB'
})

export const gpsSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
})

export const syncEventSchema = z.object({
  client_event_id: z.string().uuid(),
  evidenceBase64: base64ImageSchema,
  payload: z.object({
    client_event_id: z.string().uuid(),
    worker_id: z.string().uuid(),
    project_id: z.string().uuid(),
    type: z.enum(['in', 'out']),
    occurred_at: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: 'Tanggal occurred_at tidak valid'
    }),
    gps: gpsSchema,
    source: z.enum(['face', 'manual'])
  }).refine((data) => data.client_event_id === data.client_event_id, {
    message: 'client_event_id di payload harus sama dengan level terluar'
  })
})

export const syncRequestSchema = z.object({
  events: z.array(syncEventSchema).max(50, {
    message: 'Maksimal 50 event dalam satu request sinkronisasi'
  })
})

export const exportRequestSchema = z.object({
  projectId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Format tanggal harus YYYY-MM-DD'
  }),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Format tanggal harus YYYY-MM-DD'
  })
}).refine((data) => {
  const start = Date.parse(data.startDate)
  const end = Date.parse(data.endDate)
  return start <= end
}, {
  message: 'startDate tidak boleh lebih besar dari endDate',
  path: ['startDate']
}).refine((data) => {
  const start = Date.parse(data.startDate)
  const end = Date.parse(data.endDate)
  const diffTime = Math.abs(end - start)
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return diffDays <= 31
}, {
  message: 'Maksimal periode export/backup adalah 31 hari',
  path: ['endDate']
})

export const signedKtpRequestSchema = z.object({
  workerId: z.string().uuid()
})

export const loginRequestSchema = z.object({
  username: z.string().min(1, 'Username wajib diisi').max(50, 'Username terlalu panjang'),
  password: z.string().min(1, 'Password wajib diisi').max(100, 'Password terlalu panjang')
})
