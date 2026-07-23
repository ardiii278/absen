'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { supabase } from '@/lib/supabase'

// AbortController for fetch timeout (fallback for older environments)
const getAbortSignalTimeout = (ms: number): AbortSignal => {
  if (globalThis.AbortSignal && globalThis.AbortSignal.timeout) {
    return globalThis.AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
};

const loginSchema = z.object({
  type: z.enum(['admin', 'kiosk']),
  email: z.string().email('Email tidak valid').optional().or(z.literal('')),
  username: z.string().min(3, 'Username minimal 3 karakter').optional().or(z.literal('')),
  password: z.string().min(6, 'Password minimal 6 karakter'),
}).refine(data => {
  if (data.type === 'admin') return !!data.email && data.email !== ''
  return true;
}, {
  message: "Email wajib diisi untuk Admin",
  path: ["email"]
}).refine(data => {
  if (data.type === 'kiosk') return !!data.username && data.username !== ''
  return true;
}, {
  message: "Username wajib diisi untuk Kiosk",
  path: ["username"]
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const [authType, setAuthType] = useState<'admin' | 'kiosk'>('admin')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      type: 'admin',
    }
  })

  useEffect(() => {
    setValue('type', authType)
  }, [authType, setValue])

  const onSubmit = async (values: LoginFormValues) => {
    setErrorMsg(null)
    setLoading(true)
    let timeoutId; // To ensure loading is always reset
    try {
      if (values.type === 'admin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: values.email!,
          password: values.password,
        })
        if (error) throw error
        router.push('/admin/monitoring')
      } else {
        // Force timeout for safety
        timeoutId = setTimeout(() => {
          if (loading) { // Check if still loading
            setErrorMsg('Permintaan login melebihi batas waktu (timeout).')
            setLoading(false)
          }
        }, 15000); // 15 seconds hard timeout for the whole process

        const res = await fetch('/api/kiosk-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: values.username, password: values.password }),
          signal: getAbortSignalTimeout(10000) // 10 second timeout for fetch
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Login gagal')

        // Save session locally (for DEMO and kiosk usage, standard Supabase Auth client can ingest)
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token
        })
        
        localStorage.setItem('kiosk_project_id', data.project_id)
        router.push('/kiosk')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan sistem'
      console.error('Login error (UI):', err); // Log to console for debugging
      setErrorMsg(msg || 'Terjadi kesalahan sistem')
    } finally {
      if (timeoutId) clearTimeout(timeoutId); // Clear the force timeout
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
        <h1 className="text-2xl font-bold text-center text-slate-800 mb-6">Sistem Absensi Kiosk</h1>
        
        <div className="flex bg-slate-100 rounded-lg p-1 mb-6">
          <button
            type="button"
            className={`flex-1 py-2 text-center text-sm font-medium rounded-md transition ${
              authType === 'admin' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
            }`}
            onClick={() => setAuthType('admin')}
          >
            Admin / Super Admin
          </button>
          <button
            type="button"
            className={`flex-1 py-2 text-center text-sm font-medium rounded-md transition ${
              authType === 'kiosk' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
            }`}
            onClick={() => setAuthType('kiosk')}
          >
            Petugas Lapangan (Kiosk)
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {errorMsg}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(onSubmit)(e); }} noValidate className="space-y-4">
          <input type="hidden" {...register('type')} />

          {authType === 'admin' ? (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Email Admin</label>
              <input
                type="email"
                placeholder="admin@perusahaan.com"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 text-slate-800"
                {...register('email')}
              />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Username Kiosk</label>
              <input
                type="text"
                placeholder="kiosk_proyek_a"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 text-slate-800"
                {...register('username')}
              />
              {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username.message}</p>}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 text-slate-800"
              {...register('password')}
            />
            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-lg transition duration-200 disabled:opacity-50"
          >
            {loading ? 'Memproses...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  )
}
