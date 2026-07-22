// Face Recognition Logic with vector validation and boundary handling
export interface FaceMatcher {
  findBestMatch(descriptor: number[]): { label: string; distance: number }
}

export function isValidDescriptor(desc: unknown): desc is number[] {
  if (!Array.isArray(desc)) return false
  if (desc.length !== 128) return false
  return desc.every((val) => typeof val === 'number' && Number.isFinite(val))
}

// Simple euclidean distance between two 128-dimensional vectors
function euclideanDistance(v1: number[], v2: number[]): number {
  return Math.sqrt(
    v1.map((val, i) => (val - v2[i]) ** 2).reduce((sum, current) => sum + current, 0)
  )
}

export function createFaceMatcher(
  activeWorkers: { id: string; face_descriptor: unknown }[],
  threshold = 0.6
): FaceMatcher {
  return {
    findBestMatch(descriptor: number[]) {
      // Validate scanned descriptor
      if (!isValidDescriptor(descriptor)) {
        return { label: 'unknown', distance: 1.0 }
      }

      if (!activeWorkers || activeWorkers.length === 0) {
        return { label: 'unknown', distance: 1.0 }
      }

      let bestMatch = { label: 'unknown', distance: 1.0 }

      for (const worker of activeWorkers) {
        const workerDesc = worker.face_descriptor
        if (!workerDesc || !isValidDescriptor(workerDesc)) {
          continue
        }
        
        const dist = euclideanDistance(descriptor, workerDesc)
        if (dist < bestMatch.distance) {
          bestMatch = { label: worker.id, distance: dist }
        }
      }

      // Explicit behavior for boundary: distance <= threshold matches
      if (bestMatch.distance <= threshold && bestMatch.label !== 'unknown') {
        return bestMatch
      }

      return { label: 'unknown', distance: bestMatch.distance }
    }
  }
}
