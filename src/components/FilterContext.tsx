'use client'

import React, { createContext, useContext, useState } from 'react'

interface FilterContextValue {
  projectId: string
  jobScope: string
  setProjectId: (id: string) => void
  setJobScope: (scope: string) => void
}

const FilterContext = createContext<FilterContextValue>({
  projectId: '',
  jobScope: '',
  setProjectId: () => {},
  setJobScope: () => {}
})

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [projectId, setProjectIdState] = useState('')
  const [jobScope, setJobScope] = useState('')

  const setProjectId = (id: string) => {
    setProjectIdState(id)
    setJobScope('') // Reset sub-project when location changes
  }

  return (
    <FilterContext.Provider value={{ projectId, jobScope, setProjectId, setJobScope }}>
      {children}
    </FilterContext.Provider>
  )
}

export function useGlobalFilter() {
  return useContext(FilterContext)
}
