'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, Hand } from 'lucide-react'
import { loadFaceApiModels } from '@/lib/face/api'
import { createFaceMatcher } from '@/lib/face/matcher'
import { watermark } from '@/lib/watermark'
import { playBeepError, playBeepSuccess } from '@/lib/audio'
import { UserWorker, ScanResult } from '@/types/user'

interface UserScannerProps {
  workers: UserWorker[]
  scanMode: 'in' | 'out' | null
  gpsCoords: { latitude: number; longitude: number }
  onScanComplete: (worker: UserWorker, evidenceBlob: Blob) => void
  onCancel: () => void
  onManualFallback: () => void
  cooldownCheck: (workerId: string, type: 'in' | 'out') => string | null
}

export default function UserScanner({
  workers,
  scanMode,
  gpsCoords,
  onScanComplete,
  onCancel,
  onManualFallback,
  cooldownCheck
}: UserScannerProps) {
  const [timeRemaining, setTimeRemaining] = useState(10)
  const [matchResult, setMatchResult] = useState<ScanResult | null>(null)
  const [showCooldownPopup, setShowCooldownPopup] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState<{ name: string; time: string } | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [modelLoading, setModelLoading] = useState(true)
  const [faceDetected, setFaceDetected] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const deadlineRef = useRef(0)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const matchingRef = useRef(false)
  const completedRef = useRef(false)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current)
    scanIntervalRef.current = null
    setCameraActive(false)
  }, [])

  const attemptMatch = useCallback(async () => {
    const video = videoRef.current
    if (!video || !scanMode || matchingRef.current || completedRef.current || video.readyState < 2) return
    matchingRef.current = true
    try {
      const faceapi = await loadFaceApiModels()
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor()

      setFaceDetected(!!detection)
      if (!detection) return

      const matcher = createFaceMatcher(workers, 0.55)
      const match = matcher.findBestMatch(Array.from(detection.descriptor))
      if (match.label === 'unknown') {
        setMatchResult({ success: false, message: 'Wajah belum dikenali. Hadapkan wajah lurus atau gunakan Absen Manual.' })
        return
      }

      const worker = workers.find(item => item.id === match.label)
      if (!worker) return
      const cooldownMessage = cooldownCheck(worker.id, scanMode)
      if (cooldownMessage) {
        completedRef.current = true
        playBeepError()
        setShowCooldownPopup(cooldownMessage)
        stopCamera()
        return
      }

      completedRef.current = true
      const evidence = await watermark(video, { time: new Date(), gps: gpsCoords })
      playBeepSuccess()
      setShowSuccess({
        name: worker.name,
        time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      })
      stopCamera()
      setTimeout(() => {
        setShowSuccess(null)
        onScanComplete(worker, evidence)
      }, 3000)
    } catch (error: unknown) {
      setMatchResult({ success: false, message: error instanceof Error ? error.message : 'Pemindaian wajah gagal.' })
    } finally {
      matchingRef.current = false
    }
  }, [cooldownCheck, gpsCoords, onScanComplete, scanMode, stopCamera, workers])

  const startCamera = useCallback(async () => {
    try {
      setModelLoading(true)
      setMatchResult(null)
      const validWorkers = workers.filter(worker => worker.face_descriptor?.length === 128)
      if (validWorkers.length === 0) {
        throw new Error('Belum ada pekerja dengan data wajah valid. Gunakan Absen Manual atau daftarkan ulang foto profil.')
      }
      await loadFaceApiModels()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false
      })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      deadlineRef.current = Date.now() + 10000
      setTimeRemaining(10)
      setCameraActive(true)
      setModelLoading(false)
      scanIntervalRef.current = setInterval(attemptMatch, 700)
    } catch (error: unknown) {
      setModelLoading(false)
      playBeepError()
      let message = 'Kamera atau model wajah gagal dimuat.'
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          message = 'Izin kamera ditolak. Buka pengaturan browser dan izinkan akses kamera.'
        } else if (error.name === 'NotFoundError') {
          message = 'Kamera tidak ditemukan di perangkat ini.'
        } else if (error.name === 'NotReadableError') {
          message = 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi lain lalu coba lagi.'
        } else if (error.name === 'SecurityError') {
          message = 'Akses kamera hanya bisa via HTTPS. Gunakan https:// di URL atau deploy ke Netlify.'
        }
      }
      setMatchResult({ success: false, message })
    }
  }, [attemptMatch, workers])

  useEffect(() => {
    const timeout = setTimeout(startCamera, 0)
    return () => {
      clearTimeout(timeout)
      stopCamera()
    }
  }, [startCamera, stopCamera])

  useEffect(() => {
    if (!cameraActive) return
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000))
      setTimeRemaining(remaining)
      if (remaining <= 0 && !completedRef.current) {
        completedRef.current = true
        stopCamera()
        playBeepError()
        setMatchResult({ success: false, message: 'Batas waktu 10 detik habis. Gunakan Absen Manual jika perlu.' })
      }
    }, 200)
    return () => clearInterval(timer)
  }, [cameraActive, stopCamera])

  return (
    <div className="w-full flex flex-col items-center">
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-emerald-600/90 text-white">
          <Camera className="mb-4 h-16 w-16" />
          <h2 className="text-3xl font-bold">{showSuccess.name}</h2>
          <p className="mt-2 text-xl">Absen {scanMode === 'in' ? 'Masuk' : 'Pulang'} Berhasil</p>
          <p className="mt-1 text-lg opacity-80">{showSuccess.time}</p>
        </div>
      )}

      {showCooldownPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center">
            <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-amber-600" />
            <h3 className="text-lg font-bold text-slate-800">Cooldown Aktif</h3>
            <p className="my-4 text-sm text-slate-600">{showCooldownPopup}</p>
            <button onClick={() => { setShowCooldownPopup(null); onCancel() }} className="w-full rounded-xl bg-slate-800 py-2.5 font-semibold text-white">Mengerti</button>
          </div>
        </div>
      )}

      <div className="mb-4 text-center">
        <span className="block text-lg font-semibold">Memindai Absen {scanMode === 'in' ? 'Masuk' : 'Pulang'}</span>
        <p className="mt-1 text-xs text-slate-500">{modelLoading ? 'Memuat model wajah...' : faceDetected ? 'Wajah terdeteksi, mencocokkan...' : 'Hadapkan satu wajah ke kamera'}</p>
        <span className={`mt-2 inline-block font-mono text-sm font-bold ${timeRemaining <= 3 ? 'text-red-600' : 'text-emerald-600'}`}>{timeRemaining}s</span>
      </div>

      <div className={`relative mb-4 aspect-video w-full max-w-lg overflow-hidden rounded-2xl bg-black border-4 ${faceDetected ? 'border-emerald-400' : 'border-transparent'}`}>
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-700">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${timeRemaining * 10}%` }} />
        </div>
      </div>

      {matchResult && !matchResult.success && (
        <div className="mb-4 w-full max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-3 text-center text-sm text-amber-800">{matchResult.message}</div>
      )}

      <div className="flex w-full max-w-lg gap-3">
        <button onClick={() => { stopCamera(); onManualFallback() }} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 font-semibold text-white hover:bg-amber-600"><Hand className="h-4 w-4" />Manual</button>
        <button onClick={() => { stopCamera(); onCancel() }} className="rounded-xl bg-slate-100 px-6 py-3 font-semibold text-slate-700 hover:bg-slate-200">Batal</button>
      </div>
    </div>
  )
}
