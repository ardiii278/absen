import type * as FaceApi from '@vladmandic/face-api'

const MODEL_URL = '/models'
let faceApiPromise: Promise<typeof FaceApi> | null = null
let modelPromise: Promise<typeof FaceApi> | null = null

export async function loadFaceApiModels(): Promise<typeof FaceApi> {
  if (typeof window === 'undefined') throw new Error('Face API hanya tersedia di browser')
  if (!faceApiPromise) {
    faceApiPromise = import('@vladmandic/face-api')
  }
  if (!modelPromise) {
    modelPromise = faceApiPromise.then(async faceapi => {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ])
      return faceapi
    }).catch(error => {
      modelPromise = null
      throw error
    })
  }
  return modelPromise
}

export async function extractFaceDescriptor(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<number[]> {
  const faceapi = await loadFaceApiModels()
  const result = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!result) throw new Error('Wajah tidak terdeteksi. Pastikan wajah terang, lurus, dan tidak tertutup.')
  return Array.from(result.descriptor)
}

export async function extractDescriptorFromBlob(blob: Blob): Promise<number[]> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return await extractFaceDescriptor(image)
  } finally {
    URL.revokeObjectURL(url)
  }
}
