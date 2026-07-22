'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface KioskAccount {
  id: string
  auth_user_id: string
  username: string
  project_id: string
  is_active: boolean
  last_seen_at: string | null
  projects: { name: string } | null
}

interface Project {
  id: string
  name: string
}

interface LoginHistoryEntry {
  id: string
  username: string
  ip_address: string | null
  status: string
  created_at: string
}

interface AttendanceEntry {
  id: string
  worker_id: string | null
  type: 'in' | 'out' | null
  occurred_at: string
  source: string | null
  status: string
  workers: { name: string; nik: string } | null
}

export default function KioskAccountsPage() {
  const [accounts, setAccounts] = useState<KioskAccount[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Create form state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createUsername, setCreateUsername] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createProjectId, setCreateProjectId] = useState('')
  const [createLoading, setCreateLoading] = useState(false)

  // Edit form state
  const [showEditModal, setShowEditModal] = useState(false)
  const [editAccount, setEditAccount] = useState<KioskAccount | null>(null)
  const [editProjectId, setEditProjectId] = useState('')
  const [editIsActive, setEditIsActive] = useState(true)
  const [editNewPassword, setEditNewPassword] = useState('')
  const [editLoading, setEditLoading] = useState(false)

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteAccount, setDeleteAccount] = useState<KioskAccount | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Login history modal
  const [showLoginHistory, setShowLoginHistory] = useState(false)
  const [loginHistory, setLoginHistory] = useState<LoginHistoryEntry[]>([])
  const [loginHistoryLoading, setLoginHistoryLoading] = useState(false)
  const [loginHistoryAccount, setLoginHistoryAccount] = useState<KioskAccount | null>(null)

  // Attendance history modal
  const [showAttendanceHistory, setShowAttendanceHistory] = useState(false)
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceEntry[]>([])
  const [attendanceSummary, setAttendanceSummary] = useState({ totalRecords: 0, uniqueWorkers: 0, startDate: '', endDate: '' })
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [attendanceAccount, setAttendanceAccount] = useState<KioskAccount | null>(null)

  const getToken = async () => {
    const sessionRes = await supabase.auth.getSession()
    return sessionRes.data.session?.access_token
  }

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/kiosk-accounts', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal memuat akun kiosk')
      setAccounts(data.accounts || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchProjects = useCallback(async () => {
    try {
      const { data } = await supabase.from('projects').select('id, name')
      setProjects((data as Project[]) || [])
    } catch {
      console.error('Gagal memuat proyek')
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      fetchAccounts()
      fetchProjects()
    }, 0)
    return () => clearTimeout(t)
  }, [fetchAccounts, fetchProjects])

  const handleCreate = async () => {
    if (!createUsername || !createPassword || !createProjectId) {
      setErrorMsg('Semua field wajib diisi')
      return
    }
    setCreateLoading(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/kiosk-accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          username: createUsername,
          password: createPassword,
          projectId: createProjectId
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal membuat akun')

      setSuccessMsg(`Akun kiosk ${createUsername} berhasil dibuat!`)
      setShowCreateModal(false)
      setCreateUsername('')
      setCreatePassword('')
      setCreateProjectId('')
      await fetchAccounts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat akun'
      setErrorMsg(msg)
    } finally {
      setCreateLoading(false)
    }
  }

  const openEditModal = (account: KioskAccount) => {
    setEditAccount(account)
    setEditProjectId(account.project_id)
    setEditIsActive(account.is_active)
    setEditNewPassword('')
    setShowEditModal(true)
  }

  const handleEdit = async () => {
    if (!editAccount) return
    setEditLoading(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const token = await getToken()
      const body: { id: string; projectId?: string; isActive?: boolean; newPassword?: string } = {
        id: editAccount.id,
        projectId: editProjectId,
        isActive: editIsActive
      }
      if (editNewPassword) {
        body.newPassword = editNewPassword
      }

      const res = await fetch('/api/kiosk-accounts', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal mengupdate akun')

      setSuccessMsg(`Akun ${editAccount.username} berhasil diupdate!`)
      setShowEditModal(false)
      await fetchAccounts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengupdate akun'
      setErrorMsg(msg)
    } finally {
      setEditLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteAccount) return
    setDeleteLoading(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/kiosk-accounts?id=${deleteAccount.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus akun')

      setSuccessMsg(`Akun ${deleteAccount.username} berhasil dihapus!`)
      setShowDeleteConfirm(false)
      setDeleteAccount(null)
      await fetchAccounts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menghapus akun'
      setErrorMsg(msg)
    } finally {
      setDeleteLoading(false)
    }
  }

  const viewLoginHistory = async (account: KioskAccount) => {
    setLoginHistoryAccount(account)
    setShowLoginHistory(true)
    setLoginHistoryLoading(true)
    setLoginHistory([])
    try {
      const token = await getToken()
      const res = await fetch(`/api/kiosk-accounts/${account.id}/login-history`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal memuat histori login')
      setLoginHistory(data.history || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat histori login'
      setErrorMsg(msg)
    } finally {
      setLoginHistoryLoading(false)
    }
  }

  const viewAttendanceHistory = async (account: KioskAccount) => {
    setAttendanceAccount(account)
    setShowAttendanceHistory(true)
    setAttendanceLoading(true)
    setAttendanceHistory([])
    try {
      const token = await getToken()
      const res = await fetch(`/api/kiosk-accounts/${account.id}/attendance-history`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal memuat histori absensi')
      setAttendanceHistory(data.attendance || [])
      setAttendanceSummary(data.summary || { totalRecords: 0, uniqueWorkers: 0, startDate: '', endDate: '' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat histori absensi'
      setErrorMsg(msg)
    } finally {
      setAttendanceLoading(false)
    }
  }

  const formatDateTime = (isoStr: string | null) => {
    if (!isoStr) return 'Belum pernah'
    return new Date(isoStr).toLocaleString('id-ID')
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Kelola Akun Kiosk</h1>
              <p className="text-sm text-slate-500 mt-1">Tambah, edit, hapus akun kiosk dan pantau aktivitasnya</p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition"
            >
              + Tambah Kiosk
            </button>
          </div>
        </div>

        {/* Messages */}
        {errorMsg && (
          <div className="p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {errorMsg}
            <button onClick={() => setErrorMsg(null)} className="ml-3 text-red-500 hover:text-red-700">&times;</button>
          </div>
        )}
        {successMsg && (
          <div className="p-4 bg-emerald-50 text-emerald-700 text-sm rounded-lg border border-emerald-100">
            {successMsg}
            <button onClick={() => setSuccessMsg(null)} className="ml-3 text-emerald-500 hover:text-emerald-700">&times;</button>
          </div>
        )}

        {/* Accounts Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 text-sm font-semibold">
                  <th className="py-3 px-4">Username</th>
                  <th className="py-3 px-4">Proyek</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Terakhir Aktif</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-400">Memuat data...</td></tr>
                ) : accounts.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-400">Belum ada akun kiosk.</td></tr>
                ) : (
                  accounts.map(account => (
                    <tr key={account.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      <td className="py-3 px-4 font-semibold text-sm">{account.username}</td>
                      <td className="py-3 px-4 text-sm">{account.projects?.name || '-'}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                          account.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {account.is_active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-500">
                        {formatDateTime(account.last_seen_at)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex gap-2 justify-end flex-wrap">
                          <button
                            onClick={() => viewLoginHistory(account)}
                            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-medium transition"
                          >
                            Login
                          </button>
                          <button
                            onClick={() => viewAttendanceHistory(account)}
                            className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded text-xs font-medium transition"
                          >
                            Absensi
                          </button>
                          <button
                            onClick={() => openEditModal(account)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-medium transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => { setDeleteAccount(account); setShowDeleteConfirm(true) }}
                            className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded text-xs font-medium transition"
                          >
                            Hapus
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

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Tambah Akun Kiosk Baru</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Username</label>
                <input
                  type="text"
                  placeholder="contoh: kiosk_lokasia"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
                  value={createUsername}
                  onChange={e => setCreateUsername(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  placeholder="Minimal 6 karakter"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
                  value={createPassword}
                  onChange={e => setCreatePassword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Proyek</label>
                <select
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
                  value={createProjectId}
                  onChange={e => setCreateProjectId(e.target.value)}
                >
                  <option value="">Pilih Proyek...</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-4 mt-6">
              <button
                onClick={handleCreate}
                disabled={createLoading}
                className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-medium transition disabled:opacity-50"
              >
                {createLoading ? 'Membuat...' : 'Buat Akun'}
              </button>
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {showEditModal && editAccount && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Edit Akun: {editAccount.username}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Proyek (Lokasi)</label>
                <select
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
                  value={editProjectId}
                  onChange={e => setEditProjectId(e.target.value)}
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                <select
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
                  value={editIsActive ? 'active' : 'inactive'}
                  onChange={e => setEditIsActive(e.target.value === 'active')}
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password Baru (kosongkan jika tidak diubah)</label>
                <input
                  type="password"
                  placeholder="Minimal 6 karakter"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
                  value={editNewPassword}
                  onChange={e => setEditNewPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-4 mt-6">
              <button
                onClick={handleEdit}
                disabled={editLoading}
                className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-medium transition disabled:opacity-50"
              >
                {editLoading ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION */}
      {showDeleteConfirm && deleteAccount && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-red-800 mb-2">Hapus Akun Kiosk</h3>
            <p className="text-sm text-slate-600 mb-4">
              Anda yakin ingin menghapus akun <strong>{deleteAccount.username}</strong>?
              Tindakan ini tidak dapat dibatalkan dan akan menghapus semua data terkait.
            </p>
            <div className="flex gap-4">
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition disabled:opacity-50"
              >
                {deleteLoading ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteAccount(null) }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LOGIN HISTORY MODAL */}
      {showLoginHistory && loginHistoryAccount && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">Histori Login: {loginHistoryAccount.username}</h3>
              <button
                onClick={() => setShowLoginHistory(false)}
                className="text-slate-400 hover:text-slate-600 text-xl"
              >
                &times;
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {loginHistoryLoading ? (
                <p className="text-center text-slate-400 py-8">Memuat histori...</p>
              ) : loginHistory.length === 0 ? (
                <p className="text-center text-slate-400 py-8">Belum ada histori login.</p>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 text-xs font-semibold">
                      <th className="py-2 px-3">Waktu</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">IP Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loginHistory.map(entry => (
                      <tr key={entry.id} className="border-b border-slate-50">
                        <td className="py-2 px-3 text-sm">{formatDateTime(entry.created_at)}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            entry.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                          }`}>
                            {entry.status === 'success' ? 'Berhasil' : 'Gagal'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-sm font-mono">{entry.ip_address || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ATTENDANCE HISTORY MODAL */}
      {showAttendanceHistory && attendanceAccount && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Histori Absensi: {attendanceAccount.username}</h3>
                <p className="text-xs text-slate-500">
                  {attendanceSummary.totalRecords} catatan dari {attendanceSummary.uniqueWorkers} pekerja unik
                  ({attendanceSummary.startDate} s/d {attendanceSummary.endDate})
                </p>
              </div>
              <button
                onClick={() => setShowAttendanceHistory(false)}
                className="text-slate-400 hover:text-slate-600 text-xl"
              >
                &times;
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {attendanceLoading ? (
                <p className="text-center text-slate-400 py-8">Memuat histori...</p>
              ) : attendanceHistory.length === 0 ? (
                <p className="text-center text-slate-400 py-8">Belum ada catatan absensi.</p>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 text-xs font-semibold">
                      <th className="py-2 px-3">Waktu</th>
                      <th className="py-2 px-3">Pekerja</th>
                      <th className="py-2 px-3">NIK</th>
                      <th className="py-2 px-3">Tipe</th>
                      <th className="py-2 px-3">Sumber</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceHistory.map(entry => (
                      <tr key={entry.id} className="border-b border-slate-50">
                        <td className="py-2 px-3 text-sm">{formatDateTime(entry.occurred_at)}</td>
                        <td className="py-2 px-3 text-sm font-medium">{entry.workers?.name || '-'}</td>
                        <td className="py-2 px-3 text-sm font-mono">{entry.workers?.nik || '-'}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            entry.type === 'in' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                          }`}>
                            {entry.type === 'in' ? 'MASUK' : 'PULANG'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-xs uppercase">{entry.source || '-'}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            entry.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                            entry.status === 'rejected' ? 'bg-red-50 text-red-700' :
                            'bg-amber-50 text-amber-700'
                          }`}>
                            {entry.status === 'approved' ? 'Disetujui' :
                             entry.status === 'rejected' ? 'Ditolak' : 'Menunggu'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
