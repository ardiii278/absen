'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchProjectJobScopes, saveProjectJobScopes } from '@/lib/jobscopes'

interface Project {
  id: string
  code: string
  name: string
  lat: number | null
  lng: number | null
  radius_m: number | null
  activeWorkforce: number
  totalWorkforce: number
  scopeCounts: Record<string, number>
}

interface ProjectRow {
  id: string
  code: string
  name: string
  lat: number | null
  lng: number | null
  radius_m: number | null
}

interface WorkerAggregateRow {
  project_id: string
  job_scope: string | null
  is_active: boolean
}

export default function ProjectsManagementPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Form states (Create / Edit)
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [formCode, setFormCode] = useState('')
  const [formName, setFormName] = useState('')
  const [formLat, setFormLat] = useState('')
  const [formLng, setFormLng] = useState('')
  const [formRadius, setFormRadius] = useState('100')
  const [formLoading, setFormLoading] = useState(false)

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingProject, setDeletingProject] = useState<Project | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Job scope management state
  const [showScopeModal, setShowScopeModal] = useState(false)
  const [scopeProject, setScopeProject] = useState<Project | null>(null)
  const [scopeList, setScopeList] = useState<string[]>([])
  const [newScope, setNewScope] = useState('')
  const [scopeLoading, setScopeLoading] = useState(false)

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const [projectResult, workerResult] = await Promise.all([
        supabase.from('projects').select('id, code, name, lat, lng, radius_m').order('created_at', { ascending: false }),
        supabase.from('workers').select('id, project_id, job_scope, is_active')
      ])

      if (projectResult.error) throw projectResult.error
      if (workerResult.error) throw workerResult.error
      const workers = (workerResult.data as WorkerAggregateRow[]) || []
      const enrichedProjects = ((projectResult.data as ProjectRow[]) || []).map(project => {
        const projectWorkers = workers.filter(worker => worker.project_id === project.id)
        const scopeCounts = projectWorkers.reduce<Record<string, number>>((counts, worker) => {
          const scope = worker.job_scope?.trim() || 'Tanpa Sub Pekerjaan'
          counts[scope] = (counts[scope] || 0) + 1
          return counts
        }, {})
        return {
          ...project,
          activeWorkforce: projectWorkers.filter(worker => worker.is_active).length,
          totalWorkforce: projectWorkers.length,
          scopeCounts
        }
      })
      setProjects(enrichedProjects)
    } catch (err: unknown) {
      let msg = 'Gagal memuat data proyek'
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
      fetchProjects()
    }, 0)
    return () => clearTimeout(t)
  }, [fetchProjects])

  const openCreateModal = () => {
    setEditingProject(null)
    setFormCode(`PRJ-${Math.floor(100 + Math.random() * 900)}`)
    setFormName('')
    setFormLat('-6.200000') // Default Jakarta area
    setFormLng('106.816666')
    setFormRadius('100')
    setShowFormModal(true)
  }

  const openEditModal = (project: Project) => {
    setEditingProject(project)
    setFormCode(project.code)
    setFormName(project.name)
    setFormLat(project.lat !== null ? project.lat.toString() : '')
    setFormLng(project.lng !== null ? project.lng.toString() : '')
    setFormRadius(project.radius_m !== null ? project.radius_m.toString() : '100')
    setShowFormModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formCode || !formName) {
      setErrorMsg('Kode dan Nama proyek wajib diisi')
      return
    }

    setFormLoading(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    try {
      const payload = {
        code: formCode,
        name: formName,
        lat: formLat ? parseFloat(formLat) : null,
        lng: formLng ? parseFloat(formLng) : null,
        radius_m: formRadius ? parseInt(formRadius) : null
      }

      if (editingProject) {
        // Edit Mode
        const { error } = await supabase
          .from('projects')
          .update(payload)
          .eq('id', editingProject.id)

        if (error) throw error
        setSuccessMsg(`Proyek ${formName} berhasil diupdate!`)
      } else {
        // Create Mode
        const { error } = await supabase
          .from('projects')
          .insert(payload)

        if (error) throw error
        setSuccessMsg(`Proyek ${formName} berhasil ditambahkan!`)
      }

      setShowFormModal(false)
      await fetchProjects()
    } catch (err: unknown) {
      let msg = 'Gagal menyimpan proyek'
      if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
        msg = err.message
      }
      setErrorMsg(msg)
    } finally {
      setFormLoading(false)
    }
  }

  const openScopeModal = async (project: Project) => {
    setScopeProject(project)
    setScopeList([])
    setNewScope('')
    setShowScopeModal(true)
    setScopeLoading(true)
    try {
      const scopes = await fetchProjectJobScopes(project.id)
      setScopeList(scopes)
    } catch {
      setScopeList([])
    } finally {
      setScopeLoading(false)
    }
  }

  const persistScopes = async (projectId: string, scopes: string[]) => {
    await saveProjectJobScopes(projectId, scopes)
  }

  const handleAddScope = async () => {
    if (!scopeProject || !newScope.trim()) return
    const scope = newScope.trim().toUpperCase()
    if (scopeList.includes(scope)) {
      setErrorMsg('Sub pekerjaan sudah ada dalam daftar')
      return
    }
    setScopeLoading(true)
    setErrorMsg(null)
    try {
      const updated = [...scopeList, scope].sort()
      await persistScopes(scopeProject.id, updated)
      setScopeList(updated)
      setNewScope('')
      setSuccessMsg(`Sub pekerjaan "${scope}" ditambahkan ke ${scopeProject.name}`)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menambah sub pekerjaan')
    } finally {
      setScopeLoading(false)
    }
  }

  const handleRemoveScope = async (scope: string) => {
    if (!scopeProject) return
    setScopeLoading(true)
    setErrorMsg(null)
    try {
      const updated = scopeList.filter(s => s !== scope)
      await persistScopes(scopeProject.id, updated)
      setScopeList(updated)
      setSuccessMsg(`Sub pekerjaan "${scope}" dihapus dari daftar`)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus sub pekerjaan')
    } finally {
      setScopeLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingProject) return
    setDeleteLoading(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', deletingProject.id)

      if (error) throw error
      setSuccessMsg(`Proyek ${deletingProject.name} berhasil dihapus!`)
      setShowDeleteConfirm(false)
      setDeletingProject(null)
      await fetchProjects()
    } catch (err: unknown) {
      let msg = 'Gagal menghapus proyek'
      if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
        msg = err.message
      }
      setErrorMsg(msg)
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Title and Action */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Kelola Lokasi / Proyek</h1>
            <p className="text-sm text-slate-500 mt-1">Atur lokasi kerja, titik GPS koordinat, dan radius absensi (geofencing)</p>
          </div>
          <button
            onClick={openCreateModal}
            className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition"
          >
            + Tambah Lokasi / Proyek
          </button>
        </div>

        {/* Messages */}
        {errorMsg && (
          <div className="p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100 flex justify-between items-center">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-700 font-bold">&times;</button>
          </div>
        )}
        {successMsg && (
          <div className="p-4 bg-emerald-50 text-emerald-700 text-sm rounded-lg border border-emerald-100 flex justify-between items-center">
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700 font-bold">&times;</button>
          </div>
        )}

        {/* Table List */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 text-sm font-semibold">
                  <th className="py-3 px-4">Kode Proyek</th>
                  <th className="py-3 px-4">Nama Lokasi / Proyek</th>
                  <th className="py-3 px-4">Latitude</th>
                  <th className="py-3 px-4">Longitude</th>
                  <th className="py-3 px-4">Radius Absen</th>
                  <th className="py-3 px-4">Total Tenaga</th>
                  <th className="py-3 px-4">Sub Pekerjaan</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">Memuat data proyek...</td>
                  </tr>
                ) : projects.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">Belum ada lokasi / proyek yang terdaftar.</td>
                  </tr>
                ) : (
                  projects.map(proj => (
                    <tr key={proj.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      <td className="py-3 px-4 font-mono font-semibold text-sm text-slate-700">{proj.code}</td>
                      <td className="py-3 px-4 font-semibold text-sm text-slate-900">{proj.name}</td>
                      <td className="py-3 px-4 text-sm font-mono">{proj.lat !== null ? proj.lat.toFixed(6) : '-'}</td>
                      <td className="py-3 px-4 text-sm font-mono">{proj.lng !== null ? proj.lng.toFixed(6) : '-'}</td>
                      <td className="py-3 px-4 text-sm">{proj.radius_m !== null ? `${proj.radius_m} meter` : '-'}</td>
                      <td className="py-3 px-4 text-sm"><span className="font-bold text-slate-800">{proj.activeWorkforce}</span><span className="text-slate-400"> aktif / {proj.totalWorkforce} total</span></td>
                      <td className="py-3 px-4"><div className="flex min-w-48 flex-wrap gap-1.5">{Object.entries(proj.scopeCounts).length === 0 ? <span className="text-xs text-slate-400">Belum ada tenaga</span> : Object.entries(proj.scopeCounts).sort(([a], [b]) => a.localeCompare(b)).map(([scope, count]) => <span key={scope} className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{scope}: {count}</span>)}</div></td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => openScopeModal(proj)}
                            className="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-semibold transition"
                          >
                            Sub Pekerjaan
                          </button>
                          <button
                            onClick={() => openEditModal(proj)}
                            className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => { setDeletingProject(proj); setShowDeleteConfirm(true) }}
                            className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded text-xs font-semibold transition"
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

      {/* FORM MODAL (CREATE / EDIT) */}
      {showFormModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-slate-800 mb-4">
              {editingProject ? `Edit Lokasi: ${editingProject.name}` : 'Tambah Lokasi Proyek Baru'}
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Kode Proyek</label>
                <input
                  type="text"
                  placeholder="misal: PRJ-BDG"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
                  value={formCode}
                  onChange={e => setFormCode(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Proyek / Lokasi</label>
                <input
                  type="text"
                  placeholder="misal: Podomoro Park Bandung"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none text-slate-800"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="-6.200000"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none font-mono"
                    value={formLat}
                    onChange={e => setFormLat(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="106.816666"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none font-mono"
                    value={formLng}
                    onChange={e => setFormLng(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Radius Geofence (Meter)</label>
                <input
                  type="number"
                  placeholder="100"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
                  value={formRadius}
                  onChange={e => setFormRadius(e.target.value)}
                />
              </div>

              <div className="flex gap-4 pt-4 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-medium transition disabled:opacity-50"
                >
                  {formLoading ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowFormModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
                >
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* JOB SCOPE MANAGEMENT MODAL */}
      {showScopeModal && scopeProject && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-800 mb-1">Sub Pekerjaan / Job Scope</h3>
            <p className="text-xs text-slate-500 mb-4">Lokasi: <strong>{scopeProject.name}</strong> — Tukang bisa ditandai mengerjakan sub pekerjaan tertentu, misal HARDSCAPE CLUSTER PATRAGRIYA</p>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="misal: HARDSCAPE CLUSTER PATRAGRIYA"
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none text-slate-800 uppercase"
                value={newScope}
                onChange={e => setNewScope(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddScope() } }}
              />
              <button
                onClick={handleAddScope}
                disabled={scopeLoading || !newScope.trim()}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
              >
                Tambah
              </button>
            </div>

            <div className="space-y-2 mb-4">
              {scopeLoading && scopeList.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">Memuat...</p>
              ) : scopeList.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">Belum ada sub pekerjaan. Tambahkan di atas.</p>
              ) : (
                scopeList.map(scope => (
                  <div key={scope} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-sm font-semibold text-slate-700">{scope}</span>
                    <button
                      onClick={() => handleRemoveScope(scope)}
                      disabled={scopeLoading}
                      className="px-2 py-0.5 bg-red-50 hover:bg-red-100 text-red-600 rounded text-xs font-semibold transition disabled:opacity-50"
                    >
                      Hapus
                    </button>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setShowScopeModal(false)}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {showDeleteConfirm && deletingProject && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-red-800 mb-2">Hapus Proyek / Lokasi</h3>
            <p className="text-sm text-slate-600 mb-4">
              Anda yakin ingin menghapus proyek <strong>{deletingProject.name}</strong>?
              Tindakan ini juga akan memutuskan hubungan akun petugas lapangan (kiosk) dan data kehadiran di lokasi ini.
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
                onClick={() => { setShowDeleteConfirm(false); setDeletingProject(null) }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
