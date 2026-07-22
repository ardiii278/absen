import { describe, it, expect } from 'vitest'
import { createFaceMatcher } from '../../lib/face/matcher'

describe('Face Recognition Matcher', () => {
  it('should find the correct worker mapping when below threshold', () => {
    const mockWorkers = [
      { id: 'worker-1', face_descriptor: Array(128).fill(0.1) },
      { id: 'worker-2', face_descriptor: Array(128).fill(0.9) }
    ]

    const matcher = createFaceMatcher(mockWorkers, 0.6)
    const scanDescriptor = Array(128).fill(0.12) // very close to worker-1

    const result = matcher.findBestMatch(scanDescriptor)
    expect(result.label).toBe('worker-1')
    expect(result.distance).toBeLessThan(0.6)
  })

  it('should return unknown when distance exceeds threshold', () => {
    const mockWorkers = [
      { id: 'worker-1', face_descriptor: Array(128).fill(0.1) }
    ]

    const matcher = createFaceMatcher(mockWorkers, 0.4)
    const scanDescriptor = Array(128).fill(0.9) // very far from worker-1

    const result = matcher.findBestMatch(scanDescriptor)
    expect(result.label).toBe('unknown')
  })

  it('should handle empty scanned descriptor', () => {
    const mockWorkers = [
      { id: 'worker-1', face_descriptor: Array(128).fill(0.1) }
    ]
    const matcher = createFaceMatcher(mockWorkers, 0.6)
    const result = matcher.findBestMatch([])
    expect(result.label).toBe('unknown')
    expect(result.distance).toBe(1.0)
  })

  it('should handle descriptor with different length', () => {
    const mockWorkers = [
      { id: 'worker-1', face_descriptor: Array(128).fill(0.1) }
    ]
    const matcher = createFaceMatcher(mockWorkers, 0.6)
    const result = matcher.findBestMatch(Array(100).fill(0.1))
    expect(result.label).toBe('unknown')
    expect(result.distance).toBe(1.0)
  })

  it('should handle NaN in scanned descriptor', () => {
    const mockWorkers = [
      { id: 'worker-1', face_descriptor: Array(128).fill(0.1) }
    ]
    const matcher = createFaceMatcher(mockWorkers, 0.6)
    const scan = Array(128).fill(0.1)
    scan[0] = NaN
    const result = matcher.findBestMatch(scan)
    expect(result.label).toBe('unknown')
  })

  it('should handle Infinity in scanned descriptor', () => {
    const mockWorkers = [
      { id: 'worker-1', face_descriptor: Array(128).fill(0.1) }
    ]
    const matcher = createFaceMatcher(mockWorkers, 0.6)
    const scan = Array(128).fill(0.1)
    scan[0] = Infinity
    const result = matcher.findBestMatch(scan)
    expect(result.label).toBe('unknown')
  })

  it('should match correctly at exact threshold boundary', () => {
    const mockWorkers = [
      { id: 'worker-1', face_descriptor: Array(128).fill(0.0) }
    ]
    // Euclidean distance of vector of 128 elements filled with x from vector filled with 0.0 is sqrt(128 * x^2) = x * sqrt(128)
    // If we want distance to be exactly 0.5:
    // x * sqrt(128) = 0.5 => x = 0.5 / sqrt(128)
    const x = 0.5 / Math.sqrt(128)
    const scan = Array(128).fill(x)
    const matcher = createFaceMatcher(mockWorkers, 0.5)
    const result = matcher.findBestMatch(scan)
    
    // Should match because distance is exactly equal to the threshold
    expect(result.label).toBe('worker-1')
    expect(result.distance).toBeCloseTo(0.5, 5)
  })

  it('should return unknown when activeWorkers list is empty', () => {
    const matcher = createFaceMatcher([], 0.6)
    const scan = Array(128).fill(0.1)
    const result = matcher.findBestMatch(scan)
    expect(result.label).toBe('unknown')
    expect(result.distance).toBe(1.0)
  })
})
