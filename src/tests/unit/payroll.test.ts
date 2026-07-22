import { describe, it, expect } from 'vitest'

function calculateCreditDays(types: string[]): number {
  const hasIn = types.includes('in')
  const hasOut = types.includes('out')
  if (hasIn && hasOut) {
    return 1.0
  } else if (hasIn || hasOut) {
    return 0.5
  }
  return 0.0
}

function calculateWages({
  dailyWage,
  creditDays,
  overtimeHours,
  lateDeduction
}: {
  dailyWage: number
  creditDays: number
  overtimeHours: number
  lateDeduction: number
}): number {
  const hourlyRate = dailyWage / 8
  const overtimePay = overtimeHours * hourlyRate
  const basePay = creditDays * dailyWage
  return Math.max(0, basePay - lateDeduction + overtimePay)
}

describe('Payroll Calculations', () => {
  it('should calculate credit days correctly', () => {
    // 1. in and out on same day -> 1.0 day credit
    expect(calculateCreditDays(['in', 'out'])).toBe(1.0)
    expect(calculateCreditDays(['out', 'in'])).toBe(1.0)

    // 2. only in -> 0.5 day credit
    expect(calculateCreditDays(['in'])).toBe(0.5)

    // 3. only out -> 0.5 day credit
    expect(calculateCreditDays(['out'])).toBe(0.5)

    // 4. empty -> 0.0 day credit
    expect(calculateCreditDays([])).toBe(0.0)
  })

  it('should calculate total pay with overtime and late deductions', () => {
    // 1. normal day, no deduction, no overtime
    const pay1 = calculateWages({
      dailyWage: 160000,
      creditDays: 1.0,
      overtimeHours: 0,
      lateDeduction: 0
    })
    expect(pay1).toBe(160000)

    // 2. half day (0.5), no deduction, no overtime
    const pay2 = calculateWages({
      dailyWage: 160000,
      creditDays: 0.5,
      overtimeHours: 0,
      lateDeduction: 0
    })
    expect(pay2).toBe(80000)

    // 3. 1 day, with overtime (2 hours at dailyWage/8 = 20000/hr)
    const pay3 = calculateWages({
      dailyWage: 160000,
      creditDays: 1.0,
      overtimeHours: 2.0,
      lateDeduction: 0
    })
    expect(pay3).toBe(160000 + 40000)

    // 4. 1 day, with late deduction
    const pay4 = calculateWages({
      dailyWage: 160000,
      creditDays: 1.0,
      overtimeHours: 0,
      lateDeduction: 15000
    })
    expect(pay4).toBe(160000 - 15000)

    // 5. negative wage fallback to 0
    const pay5 = calculateWages({
      dailyWage: 160000,
      creditDays: 0.5,
      overtimeHours: 0,
      lateDeduction: 100000
    })
    expect(pay5).toBe(0)
  })

  it('should handle shift crossing midnight', () => {
    // A shift crossing midnight is represented by an 'in' on Day 1 and an 'out' on Day 2.
    // Day 1 has only 'in' -> 0.5 credit
    // Day 2 has only 'out' -> 0.5 credit
    // Total credit should sum to 1.0 credit day.
    const day1Credit = calculateCreditDays(['in'])
    const day2Credit = calculateCreditDays(['out'])
    const totalCredit = day1Credit + day2Credit
    expect(totalCredit).toBe(1.0)

    const totalPay = calculateWages({
      dailyWage: 200000,
      creditDays: totalCredit,
      overtimeHours: 0,
      lateDeduction: 0
    })
    expect(totalPay).toBe(200000)
  })
})
