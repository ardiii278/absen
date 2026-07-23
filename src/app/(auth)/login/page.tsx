'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
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
      router.push('/kiosk')
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
        <h1 className="text-2xl font-bold text-center text-slate-800 mb-6">Sistem Absensi Kiosk</h1>

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {errorMsg}
          </div>
        )}

        <form method="post" onSubmit={(e) => { e.preventDefault(); handleSubmit(onSubmit)(e) }} noValidate className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Username</label>
            <input
              type="text"
              placeholder="Masukkan username"
              autoComplete="username"
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 text-slate-800"
              {...register('username')}
            />
            {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
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

        <p className="text-center text-xs text-slate-400 mt-6">
          Admin?{' '}
          <a href="/admin/login" className="text-emerald-700 hover:underline font-medium">Login Admin</a>
        </p>
      </div>
    </div>
  )
}
