'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { ShieldCheck } from 'lucide-react'
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

export default function AdminLoginPage() {
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
        body: JSON.stringify({ mode: 'admin', username: values.username, password: values.password }),
        signal: getAbortSignalTimeout(10000),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login gagal')

      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      })

      router.push('/admin/monitoring')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan sistem'
      console.error('Admin login error:', err)
      setErrorMsg(msg || 'Terjadi kesalahan sistem')
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-slate-950 p-4 overflow-hidden">
      {/* Decorative background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[28rem] w-[28rem] rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-teal-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-fade-up">
        <div className="bg-white rounded-3xl shadow-2xl shadow-black/40 p-8">
          <div className="text-center mb-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 shadow-lg shadow-slate-900/30">
              <ShieldCheck className="h-7 w-7 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Admin Login</h1>
            <p className="text-sm text-slate-500 mt-1">Super Admin / Admin Proyek</p>
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
                placeholder="Masukkan username admin"
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

        <p className="text-center text-xs text-slate-400 mt-5">
          User lapangan?{' '}
          <a href="/login" className="text-emerald-400 hover:text-emerald-300 hover:underline font-semibold">Login Kiosk</a>
        </p>
      </div>
    </div>
  )
}
