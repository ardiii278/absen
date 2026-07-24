export type CameraFacingMode = 'user' | 'environment'

export function getCameraErrorMessage(error: unknown): string {
  if (!window.isSecureContext) {
    return 'Kamera hanya dapat digunakan melalui HTTPS. Buka alamat aplikasi dengan https://.'
  }
  if (!(error instanceof DOMException)) return 'Gagal memulai kamera. Muat ulang halaman lalu coba lagi.'

  switch (error.name) {
    case 'NotAllowedError':
      return 'Izin kamera ditolak. Izinkan kamera dari pengaturan situs browser lalu coba lagi.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Kamera yang sesuai tidak ditemukan di perangkat ini.'
    case 'NotReadableError':
    case 'AbortError':
      return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi kamera lain lalu coba lagi.'
    default:
      return 'Gagal memulai kamera. Muat ulang halaman lalu coba lagi.'
  }
}

export async function openCamera(facingMode: CameraFacingMode): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new DOMException('Camera requires a secure context', 'SecurityError')
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: { ideal: facingMode }
      },
      audio: false
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    }
    throw error
  }
}

export async function attachCameraStream(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.srcObject = stream
  video.muted = true
  video.playsInline = true

  await video.play()
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) return

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('Kamera tidak mengirimkan gambar.')), 8000)
    const finish = (error?: Error) => {
      window.clearTimeout(timeout)
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('playing', onReady)
      video.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onReady = () => {
      if (video.videoWidth > 0) finish()
    }
    const onError = () => finish(new Error('Video kamera gagal diputar.'))

    video.addEventListener('loadeddata', onReady)
    video.addEventListener('playing', onReady)
    video.addEventListener('error', onError)
  })
}
