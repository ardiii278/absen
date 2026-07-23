'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Bell, Moon, Sun, ChevronDown, MapPin, Layers, Check } from 'lucide-react'
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
  const filtersRef = useRef<HTMLDivElement>(null)

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

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) {
        setShowProjectDropdown(false)
        setShowScopeDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
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

  const dropdownPanel =
    'absolute top-full left-0 mt-2 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200/80 dark:border-slate-700 z-50 py-1.5 max-h-64 overflow-y-auto animate-fade-up'
  const dropdownItem =
    'w-full flex items-center justify-between gap-2 text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/70 transition'

  return (
    <header className="h-16 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-700/60 flex items-center justify-between px-4 md:px-6 shrink-0 sticky top-0 z-20">
      <div className="flex items-center gap-2" ref={filtersRef}>
        {/* Location Dropdown */}
        <div className="relative">
          <button
            onClick={() => { setShowProjectDropdown(!showProjectDropdown); setShowScopeDropdown(false) }}
            className="flex items-center gap-2 pl-3 pr-2.5 py-2 bg-slate-100/80 dark:bg-slate-700/60 rounded-xl text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-600/70 transition ring-1 ring-inset ring-slate-200/60 dark:ring-slate-600/40"
          >
            <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="truncate max-w-[160px]">
              {selectedProject ? selectedProject.name : 'Semua Lokasi'}
            </span>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showProjectDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showProjectDropdown && (
            <div className={dropdownPanel}>
              <button
                onClick={() => { onProjectChange(''); setShowProjectDropdown(false) }}
                className={`${dropdownItem} ${!selectedProjectId ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}
              >
                <span>Semua Lokasi</span>
                {!selectedProjectId && <Check className="w-4 h-4 shrink-0" />}
              </button>
              {projects.map(p => (
                <button
                  key={p.id}
                  onClick={() => { onProjectChange(p.id); setShowProjectDropdown(false) }}
                  className={`${dropdownItem} ${selectedProjectId === p.id ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}
                >
                  <span className="truncate">{p.name}</span>
                  {selectedProjectId === p.id && <Check className="w-4 h-4 shrink-0" />}
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
              className="flex items-center gap-2 pl-3 pr-2.5 py-2 bg-slate-100/80 dark:bg-slate-700/60 rounded-xl text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-600/70 transition ring-1 ring-inset ring-slate-200/60 dark:ring-slate-600/40"
            >
              <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="truncate max-w-[160px]">
                {selectedJobScope || 'Semua Proyek'}
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showScopeDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showScopeDropdown && (
              <div className={dropdownPanel}>
                <button
                  onClick={() => { onJobScopeChange(''); setShowScopeDropdown(false) }}
                  className={`${dropdownItem} ${!selectedJobScope ? 'font-bold text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}
                >
                  <span>Semua Proyek</span>
                  {!selectedJobScope && <Check className="w-4 h-4 shrink-0" />}
                </button>
                {jobScopes.length === 0 ? (
                  <p className="px-4 py-2.5 text-xs text-slate-400">Belum ada sub pekerjaan</p>
                ) : (
                  jobScopes.map(scope => (
                    <button
                      key={scope}
                      onClick={() => { onJobScopeChange(scope); setShowScopeDropdown(false) }}
                      className={`${dropdownItem} ${selectedJobScope === scope ? 'font-bold text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}
                    >
                      <span className="truncate">{scope}</span>
                      {selectedJobScope === scope && <Check className="w-4 h-4 shrink-0" />}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
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
              <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white dark:ring-slate-800">
                {pendingApprovalCount > 9 ? '9+' : pendingApprovalCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2.5 pl-3 ml-1 border-l border-slate-200 dark:border-slate-700">
          <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-full flex items-center justify-center text-white text-xs font-bold uppercase shadow-sm shadow-emerald-700/30">
            {(adminName || 'A').charAt(0)}
          </div>
          <span className="hidden sm:block text-[13px] font-semibold text-slate-700 dark:text-slate-200 max-w-[120px] truncate">{adminName}</span>
        </div>
      </div>
    </header>
  )
}
