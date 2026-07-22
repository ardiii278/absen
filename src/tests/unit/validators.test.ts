import { describe, it, expect } from 'vitest'
import { isValidImageSignature } from '../../lib/validators'

describe('Image Signature Validators', () => {
  it('should validate JPEG headers correctly', () => {
    // JPEG header: FF D8 FF
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])
    expect(isValidImageSignature(jpeg)).toBe(true)
  })

  it('should validate PNG headers correctly', () => {
    // PNG header: 89 50 4E 47
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    expect(isValidImageSignature(png)).toBe(true)
  })

  it('should reject invalid image headers', () => {
    // Plain text or other headers
    const txt = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF
    const short = Buffer.from([0xFF, 0xD8])
    expect(isValidImageSignature(txt)).toBe(false)
    expect(isValidImageSignature(short)).toBe(false)
  })
})
