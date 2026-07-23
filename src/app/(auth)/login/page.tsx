'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { ScanFace } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const getAbortSignalTimeout = (ms: number): AbortSignal => {
  if (globalThis.AbortSignal?.timeout) return globalThis.AbortSignal.timeout(ms)
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

const loginSchema = z.object({
  username: z.string().min(3, 'Username minimal 3 karakter'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (values: LoginFormValues) => {
    setErrorMsg(null)
    setLoading(true)
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      timeoutId = setTimeout(() => {
        setErrorMsg('Permintaan login melebihi batas waktu (timeout).')
        setLoading(false)
      }, 15000)

      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'kiosk', username: values.username, password: values.password }),
        signal: getAbortSignalTimeout(10000),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login gagal')

      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      })

      localStorage.setItem('kiosk_project_id', data.project_id)
      router.push('/user')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan sistem'
      console.error('Login error:', err)
      setErrorMsg(msg || 'Terjadi kesalahan sistem')
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-slate-100 p-4 overflow-hidden">
      {/* Decorative background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-emerald-300/30 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-teal-300/30 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-fade-up">
        <div className="bg-white/90 backdrop-blur rounded-3xl shadow-xl shadow-slate-900/5 border border-white/60 p-8">
          <div className="text-center mb-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-600/30">
              <ScanFace className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sistem Absensi</h1>
            <p className="text-sm text-slate-500 mt-1">Masuk untuk memulai absensi lapangan</p>
          </div>

          {errorMsg && (
            <div className="mb-5 alert-error">
              <span>{errorMsg}</span>
            </div>
          )}

          <form method="post" onSubmit={(e) => { e.preventDefault(); handleSubmit(onSubmit)(e) }} noValidate className="space-y-4">
            <div>
              <label className="form-label">Username</label>
              <input
                type="text"
                placeholder="Masukkan username"
                autoComplete="username"
                className="input"
                {...register('username')}
              />
              {errors.username && <p className="text-red-500 text-xs mt-1.5">{errors.username.message}</p>}
            </div>

            <div>
              <label className="form-label">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                className="input"
                {...register('password')}
              />
              {errors.password && <p className="text-red-500 text-xs mt-1.5">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full mt-2 py-3 text-[15px]"
            >
              {loading ? 'Memproses...' : 'Masuk'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-5">
          Admin?{' '}
          <a href="/admin/login" className="text-emerald-700 hover:text-emerald-800 hover:underline font-semibold">Login Admin</a>
        </p>
      </div>
    </div>
  )
}
