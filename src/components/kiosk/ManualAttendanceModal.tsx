'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, Camera, X } from 'lucide-react'
import { KioskWorker, MANUAL_NOTES } from '@/types/kiosk'
import { watermark } from '@/lib/watermark'
import { playBeepSuccess } from '@/lib/audio'
import Modal from '@/components/ui/Modal'

interface ManualAttendanceModalProps {
  isOpen: boolean
  onClose: () => void
  workers: KioskWorker[]
  scanMode: 'in' | 'out'
  gpsCoords: { latitude: number; longitude: number }
  onSubmit: (worker: KioskWorker, evidenceBlob: Blob, note: string) => void
  cooldownCheck: (workerId: string, type: 'in' | 'out') => string | null
}

export default function ManualAttendanceModal({
  isOpen,
  onClose,
  workers,
  scanMode,
  gpsCoords,
  onSubmit,
  cooldownCheck
}: ManualAttendanceModalProps) {
  const [search, setSearch] = useState('')
  const [selectedWorker, setSelectedWorker] = useState<KioskWorker | null>(null)
  const [note, setNote] = useState('Normal')
  const [cameraActive, setCameraActive] = useState(false)
  const [photoTaken, setPhotoTaken] = useState(false)
  const [cooldownMsg, setCooldownMsg] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const evidenceRef = useRef<Blob | null>(null)

  const filteredWorkers = search.length > 0
    ? workers.filter(w =>
        w.name.toLowerCase().includes(search.toLowerCase()) ||
        w.nik.includes(search)
      )
    : []

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }, [])

  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  const handleClose = () => {
    setSearch('')
    setSelectedWorker(null)
    setNote('Normal')
    setPhotoTaken(false)
    setCooldownMsg(null)
    evidenceRef.current = null
    stopCamera()
    onClose()
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCameraActive(true)
    } catch {
      setCooldownMsg('Gagal mengakses kamera.')
    }
  }

  const snapPhoto = async () => {
    if (!videoRef.current) return
    const blob = await watermark(videoRef.current, { time: new Date(), gps: gpsCoords })
    evidenceRef.current = blob
    setPhotoTaken(true)
    stopCamera()
    playBeepSuccess()
  }

  const handleSelectWorker = (worker: KioskWorker) => {
    setSelectedWorker(worker)
    setSearch('')
    setCooldownMsg(null)
    const msg = cooldownCheck(worker.id, scanMode)
    if (msg) {
      setCooldownMsg(msg)
    }
  }

  const handleSubmit = () => {
    if (!selectedWorker || !evidenceRef.current) return
    onSubmit(selectedWorker, evidenceRef.current, note)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Absen ${scanMode === 'in' ? 'Masuk' : 'Pulang'} Manual`}
      subtitle="Pilih pekerja, ambil foto bukti, dan pilih catatan kendala"
      maxWidth="lg"
    >
      {/* Search Bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Ketik nama atau NIK pekerja..."
          className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {/* Search Results */}
      {!selectedWorker && search.length > 0 && (
        <div className="mb-4 max-h-48 overflow-y-auto border border-slate-100 rounded-lg">
          {filteredWorkers.length === 0 ? (
            <p className="p-3 text-xs text-slate-400 text-center">Pekerja tidak ditemukan</p>
          ) : (
            filteredWorkers.map(w => (
              <button
                key={w.id}
                onClick={() => handleSelectWorker(w)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition border-b border-slate-50 last:border-0"
              >
                <span className="font-semibold text-sm text-slate-800">{w.name}</span>
                <span className="text-xs text-slate-400 ml-2 font-mono">{w.nik}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Selected Worker Info */}
      {selectedWorker && (
        <div className="mb-4 p-3 bg-emerald-50 rounded-lg border border-emerald-100 flex items-center justify-between">
          <div>
            <span className="font-semibold text-sm text-emerald-800">{selectedWorker.name}</span>
            <span className="text-xs text-emerald-600 ml-2 font-mono">{selectedWorker.nik}</span>
          </div>
          <button onClick={() => { setSelectedWorker(null); setPhotoTaken(false); evidenceRef.current = null }} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Cooldown Warning */}
      {cooldownMsg && (
        <div className="mb-4 p-3 bg-amber-50 text-amber-700 text-xs rounded-lg border border-amber-200">
          {cooldownMsg}
        </div>
      )}

      {/* Photo Capture */}
      {selectedWorker && !cooldownMsg && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-700 mb-2">Foto Bukti</label>
          {cameraActive ? (
            <div className="relative">
              <div className="aspect-video bg-black rounded-xl overflow-hidden mb-2">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              </div>
              <button
                onClick={snapPhoto}
                className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-semibold transition"
              >
                Tangkap Foto
              </button>
            </div>
          ) : photoTaken ? (
            <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100 text-center text-xs text-emerald-700 font-semibold">
              Foto bukti berhasil diambil
            </div>
          ) : (
            <button
              onClick={startCamera}
              className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-500 hover:border-emerald-300 hover:text-emerald-600 transition"
            >
              <Camera className="w-4 h-4" />
              Ambil Foto Bukti
            </button>
          )}
        </div>
      )}

      {/* Notes Dropdown */}
      {selectedWorker && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Catatan Kendala</label>
          <select
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
            value={note}
            onChange={e => setNote(e.target.value)}
          >
            {MANUAL_NOTES.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}

      {/* Submit */}
      <div className="flex gap-3 pt-4 border-t border-slate-100">
        <button
          onClick={handleSubmit}
          disabled={!selectedWorker || !photoTaken || !!cooldownMsg}
          className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold transition disabled:opacity-50"
        >
          Konfirmasi Absen
        </button>
        <button
          onClick={handleClose}
          className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold transition"
        >
          Batal
        </button>
      </div>
    </Modal>
  )
}
