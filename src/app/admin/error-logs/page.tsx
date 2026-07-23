'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface ErrorLog {
  id: string
  pathname: string
  method: string
  error_message: string
  stack_trace: string | null
  created_at: string
}

export default function ErrorLogsPage() {
  const [logs, setLogs] = useState<ErrorLog[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [selectedLog, setSelectedLog] = useState<ErrorLog | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const { data, error } = await supabase
        .from('error_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error
      setLogs((data as ErrorLog[]) || [])
    } catch (err: unknown) {
      let msg = 'Gagal memuat log error'
      if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
        msg = err.message
      }
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      fetchLogs()
    }, 0)
    return () => clearTimeout(t)
  }, [fetchLogs])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    alert('Detail log berhasil disalin!')
  }

  const downloadLog = (log: ErrorLog) => {
    const data = JSON.stringify(log, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `error_log_${log.id}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const downloadAllLogs = () => {
    const data = JSON.stringify(logs, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'all_error_logs.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Histori Error Sistem</h1>
            <p className="text-sm text-slate-500 mt-1">Daftar error API server dan stack trace untuk debugging</p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={fetchLogs}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold transition"
            >
              Refresh
            </button>
            <button
              onClick={downloadAllLogs}
              disabled={logs.length === 0}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
            >
              Unduh Semua (.json)
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {errorMsg}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 text-sm font-semibold">
                  <th className="py-3 px-4">Waktu</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4">Path</th>
                  <th className="py-3 px-4">Pesan Error</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">Memuat log...</td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">Tidak ada log error tercatat.</td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      <td className="py-3 px-4 text-xs font-mono text-slate-500">
                        {new Date(log.created_at).toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-4 text-sm font-bold uppercase">{log.method}</td>
                      <td className="py-3 px-4 text-xs font-mono">{log.pathname}</td>
                      <td className="py-3 px-4 text-sm text-red-600 max-w-xs truncate" title={log.error_message}>
                        {log.error_message}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setSelectedLog(log)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-xs transition"
                          >
                            Detail
                          </button>
                          <button
                            onClick={() => copyToClipboard(`${log.pathname} [${log.method}] - ${log.error_message}\n\nStack:\n${log.stack_trace || ''}`)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs transition"
                          >
                            Salin
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* DETAIL MODAL */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Detail Error</h3>
                <p className="text-xs text-slate-500">{new Date(selectedLog.created_at).toLocaleString('id-ID')}</p>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-slate-600 text-2xl"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 mb-4">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="font-bold block text-slate-400">METHOD</span>
                  <span className="uppercase font-semibold text-slate-800">{selectedLog.method}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-bold block text-slate-400">PATHNAME</span>
                  <span className="font-mono text-slate-800">{selectedLog.pathname}</span>
                </div>
              </div>
              <div>
                <span className="text-xs font-bold block text-slate-400">PESAN ERROR</span>
                <p className="text-sm font-semibold text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">
                  {selectedLog.error_message}
                </p>
              </div>
              <div>
                <span className="text-xs font-bold block text-slate-400 mb-1">STACK TRACE</span>
                <pre className="text-[10px] font-mono bg-slate-900 text-emerald-400 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-64">
                  {selectedLog.stack_trace || 'Tidak ada stack trace.'}
                </pre>
              </div>
            </div>
            <div className="flex gap-4 border-t border-slate-100 pt-4">
              <button
                onClick={() => downloadLog(selectedLog)}
                className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-medium transition"
              >
                Unduh JSON
              </button>
              <button
                onClick={() => copyToClipboard(`Path: ${selectedLog.pathname}\nMethod: ${selectedLog.method}\nMessage: ${selectedLog.error_message}\n\nStack:\n${selectedLog.stack_trace || ''}`)}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium transition"
              >
                Salin Log
              </button>
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
