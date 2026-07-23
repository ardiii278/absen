'use client'

import React, { useEffect, useState } from 'react'
import { Bell, Moon, Sun, ChevronDown, User, MapPin, Layers } from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'
import { supabase } from '@/lib/supabase'
import { fetchProjectJobScopes } from '@/lib/jobscopes'
import { Project } from '@/types'

interface TopbarProps {
  pendingApprovalCount: number
  selectedProjectId: string
  onProjectChange: (projectId: string) => void
  selectedJobScope?: string
  onJobScopeChange?: (scope: string) => void
}

export default function Topbar({
  pendingApprovalCount,
  selectedProjectId,
  onProjectChange,
  selectedJobScope = '',
  onJobScopeChange
}: TopbarProps) {
  const { theme, toggleTheme } = useTheme()
  const [projects, setProjects] = useState<Project[]>([])
  const [jobScopes, setJobScopes] = useState<string[]>([])
  const [adminName, setAdminName] = useState<string>('')
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [showScopeDropdown, setShowScopeDropdown] = useState(false)

  useEffect(() => {
    async function loadData() {
      const { data: sessionData } = await supabase.auth.getSession()
      if (sessionData.session) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', sessionData.session.user.id)
          .maybeSingle()
        if (profile) {
          setAdminName(profile.full_name || 'Admin')
        }
      }

      const { data: projData } = await supabase.from('projects').select('id, code, name, lat, lng, radius_m, created_at')
      setProjects((projData as Project[]) || [])
    }
    loadData()
  }, [])

  // Load job scopes when project changes
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (selectedProjectId) {
        fetchProjectJobScopes(selectedProjectId).then(setJobScopes)
      } else {
        setJobScopes([])
      }
    }, 0)
    return () => clearTimeout(timeout)
  }, [selectedProjectId])

  const selectedProject = projects.find(p => p.id === selectedProjectId)

  return (
    <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-3">
        {/* Location Dropdown */}
        <div className="relative">
          <button
            onClick={() => { setShowProjectDropdown(!showProjectDropdown); setShowScopeDropdown(false) }}
            className="flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-700 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 transition border border-slate-200 dark:border-slate-600"
          >
            <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="truncate max-w-[180px]">
              {selectedProject ? selectedProject.name : 'Semua Lokasi'}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </button>

          {showProjectDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 z-50 py-1 max-h-64 overflow-y-auto">
              <button
                onClick={() => { onProjectChange(''); setShowProjectDropdown(false) }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition ${
                  !selectedProjectId ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                Semua Lokasi
              </button>
              {projects.map(p => (
                <button
                  key={p.id}
                  onClick={() => { onProjectChange(p.id); setShowProjectDropdown(false) }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition ${
                    selectedProjectId === p.id ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sub-Project / Job Scope Dropdown (only when a location is selected) */}
        {selectedProjectId && onJobScopeChange && (
          <div className="relative">
            <button
              onClick={() => { setShowScopeDropdown(!showScopeDropdown); setShowProjectDropdown(false) }}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-700 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 transition border border-slate-200 dark:border-slate-600"
            >
              <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="truncate max-w-[180px]">
                {selectedJobScope || 'Semua Proyek'}
              </span>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </button>

            {showScopeDropdown && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 z-50 py-1 max-h-64 overflow-y-auto">
                <button
                  onClick={() => { onJobScopeChange(''); setShowScopeDropdown(false) }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition ${
                    !selectedJobScope ? 'font-bold text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  Semua Proyek
                </button>
                {jobScopes.length === 0 ? (
                  <p className="px-4 py-2.5 text-xs text-slate-400">Belum ada sub pekerjaan</p>
                ) : (
                  jobScopes.map(scope => (
                    <button
                      key={scope}
                      onClick={() => { onJobScopeChange(scope); setShowScopeDropdown(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition ${
                        selectedJobScope === scope ? 'font-bold text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {scope}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition text-slate-500 dark:text-slate-400"
          title={theme === 'light' ? 'Mode Gelap' : 'Mode Terang'}
        >
          {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
        </button>

        <div className="relative">
          <button className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition text-slate-500 dark:text-slate-400">
            <Bell className="w-5 h-5" />
            {pendingApprovalCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {pendingApprovalCount > 9 ? '9+' : pendingApprovalCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 pl-3 border-l border-slate-200 dark:border-slate-700">
          <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/50 rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          </div>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 max-w-[120px] truncate">{adminName}</span>
        </div>
      </div>
    </header>
  )
}
