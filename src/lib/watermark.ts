export async function watermark(
  video: HTMLVideoElement,
  m: { time: Date; gps: { latitude: number; longitude: number } }
): Promise<Blob> {
  const c = document.createElement('canvas')
  const sourceWidth = video.videoWidth || 640
  const sourceHeight = video.videoHeight || 480
  const scale = Math.min(1, 960 / sourceWidth, 720 / sourceHeight)
  c.width = Math.round(sourceWidth * scale)
  c.height = Math.round(sourceHeight * scale)
  const x = c.getContext('2d')
  if (!x) throw new Error('Failed to get canvas 2d context')
  x.drawImage(video, 0, 0, c.width, c.height)
  
  // Overlay background bar
  x.fillStyle = 'rgba(0, 0, 0, .65)'
  x.fillRect(0, c.height - 72, c.width, 72)
  
  // Watermark text
  x.fillStyle = '#ffffff'
  x.font = `${Math.max(14, Math.round(c.width / 48))}px Arial`
  x.fillText(
    `${m.time.toLocaleString('id-ID')} | ${m.gps.latitude.toFixed(6)}, ${m.gps.longitude.toFixed(6)}`,
    16,
    c.height - 28
  )
  
  return new Promise<Blob>((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to generate watermark canvas blob'))), 'image/jpeg', 0.75)
  })
}
