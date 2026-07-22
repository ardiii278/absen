export async function watermark(
  video: HTMLVideoElement,
  m: { time: Date; gps: { latitude: number; longitude: number } }
): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = video.videoWidth || 640
  c.height = video.videoHeight || 480
  const x = c.getContext('2d')!
  x.drawImage(video, 0, 0)
  
  // Overlay background bar
  x.fillStyle = 'rgba(0, 0, 0, .65)'
  x.fillRect(0, c.height - 72, c.width, 72)
  
  // Watermark text
  x.fillStyle = '#ffffff'
  x.font = '20px Arial'
  x.fillText(
    `${m.time.toLocaleString('id-ID')} | ${m.gps.latitude.toFixed(6)}, ${m.gps.longitude.toFixed(6)}`,
    16,
    c.height - 28
  )
  
  return new Promise<Blob>((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to generate watermark canvas blob'))), 'image/jpeg', 0.85)
  })
}
