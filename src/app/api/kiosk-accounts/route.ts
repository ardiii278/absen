import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, createServiceClient, createAuditLog } from '@/lib/server-auth'

// GET: List all kiosk accounts with project info
export async function GET(req: NextRequest) {
  try {
    let authContext
    try {
      authContext = await verifyAuth(req)
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : ''
      const msg = errorMsg === 'FORBIDDEN' ? 'Akses ditolak' : 'Sesi tidak valid atau tidak ditemukan'
      return NextResponse.json({ error: msg }, { status: errorMsg === 'FORBIDDEN' ? 403 : 401 })
    }

    // Only super_admin and admin can view kiosk accounts
    if (authContext.profile.role !== 'super_admin' && authContext.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Hanya Admin atau Super Admin yang diizinkan' }, { status: 403 })
    }

    const serviceClient = createServiceClient()

    // If admin, only show kiosk accounts for projects they manage
    let query = serviceClient
      .from('kiosk_accounts')
      .select('id, auth_user_id, username, project_id, is_active, last_seen_at, projects(name)')

    if (authContext.profile.role === 'admin') {
      // Get admin's projects first
      const { data: adminProjects } = await serviceClient
        .from('admin_projects')
        .select('project_id')
        .eq('user_id', authContext.user.id)

      const projectIds = (adminProjects || []).map((p: { project_id: string }) => p.project_id)
      if (projectIds.length > 0) {
        query = query.in('project_id', projectIds)
      } else {
        return NextResponse.json({ accounts: [] })
      }
    }

    const { data: accounts, error } = await query.order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: 'Gagal mengambil data akun kiosk' }, { status: 500 })
    }

    return NextResponse.json({ accounts: accounts || [] })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan sistem' }, { status: 500 })
  }
}

// POST: Create new kiosk account
export async function POST(req: NextRequest) {
  try {
    let authContext
    try {
      authContext = await verifyAuth(req)
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : ''
      const msg = errorMsg === 'FORBIDDEN' ? 'Akses ditolak' : 'Sesi tidak valid atau tidak ditemukan'
      return NextResponse.json({ error: msg }, { status: errorMsg === 'FORBIDDEN' ? 403 : 401 })
    }

    // Only super_admin can create kiosk accounts
    if (authContext.profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Hanya Super Admin yang diizinkan membuat akun kiosk' }, { status: 403 })
    }

    const body = await req.json()
    const { username, password, projectId } = body

    if (!username || !password || !projectId) {
      return NextResponse.json({ error: 'Username, password, dan project wajib diisi' }, { status: 400 })
    }

    if (username.length < 3) {
      return NextResponse.json({ error: 'Username minimal 3 karakter' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 })
    }

    const serviceClient = createServiceClient()

    // Check if username already exists
    const { data: existingKiosk } = await serviceClient
      .from('kiosk_accounts')
      .select('id')
      .eq('username', username)
      .maybeSingle()

    if (existingKiosk) {
      return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 409 })
    }

    // Verify project exists
    const { data: project } = await serviceClient
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .maybeSingle()

    if (!project) {
      return NextResponse.json({ error: 'Proyek tidak ditemukan' }, { status: 404 })
    }

    // Create auth user with internal email format
    const email = `kiosk_${username}@internal-kiosk.local`
    const { data: authUser, error: authError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })

    if (authError || !authUser.user) {
      return NextResponse.json({ error: 'Gagal membuat akun auth: ' + (authError?.message || 'Unknown error') }, { status: 500 })
    }

    // Create profile
    const { error: profileError } = await serviceClient
      .from('profiles')
      .insert({
        id: authUser.user.id,
        role: 'kiosk',
        full_name: `Kiosk ${username}`
      })

    if (profileError) {
      // Rollback: delete auth user
      await serviceClient.auth.admin.deleteUser(authUser.user.id)
      return NextResponse.json({ error: 'Gagal membuat profil kiosk' }, { status: 500 })
    }

    // Create kiosk account
    const { data: kioskAccount, error: kioskError } = await serviceClient
      .from('kiosk_accounts')
      .insert({
        auth_user_id: authUser.user.id,
        username,
        project_id: projectId,
        is_active: true
      })
      .select()
      .single()

    if (kioskError) {
      // Rollback: delete profile and auth user
      await serviceClient.from('profiles').delete().eq('id', authUser.user.id)
      await serviceClient.auth.admin.deleteUser(authUser.user.id)
      return NextResponse.json({ error: 'Gagal membuat akun kiosk' }, { status: 500 })
    }

    // Audit log
    await createAuditLog(
      serviceClient,
      authContext.user.id,
      'kiosk_accounts',
      kioskAccount.id,
      'CREATED_KIOSK_ACCOUNT',
      `Membuat akun kiosk ${username} untuk proyek ${project.name}`,
      null,
      { username, project_id: projectId, project_name: project.name }
    )

    return NextResponse.json({
      success: true,
      account: {
        id: kioskAccount.id,
        username,
        project_id: projectId,
        project_name: project.name,
        is_active: true
      }
    })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan sistem' }, { status: 500 })
  }
}

// PUT: Update kiosk account (change project, toggle active, reset password)
export async function PUT(req: NextRequest) {
  try {
    let authContext
    try {
      authContext = await verifyAuth(req)
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : ''
      const msg = errorMsg === 'FORBIDDEN' ? 'Akses ditolak' : 'Sesi tidak valid atau tidak ditemukan'
      return NextResponse.json({ error: msg }, { status: errorMsg === 'FORBIDDEN' ? 403 : 401 })
    }

    // Only super_admin can update kiosk accounts
    if (authContext.profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Hanya Super Admin yang diizinkan mengubah akun kiosk' }, { status: 403 })
    }

    const body = await req.json()
    const { id, projectId, isActive, newPassword } = body

    if (!id) {
      return NextResponse.json({ error: 'ID akun wajib diisi' }, { status: 400 })
    }

    const serviceClient = createServiceClient()

    // Fetch current kiosk account
    const { data: currentAccount, error: fetchError } = await serviceClient
      .from('kiosk_accounts')
      .select('id, auth_user_id, username, project_id, is_active')
      .eq('id', id)
      .maybeSingle()

    if (fetchError || !currentAccount) {
      return NextResponse.json({ error: 'Akun kiosk tidak ditemukan' }, { status: 404 })
    }

    // Build update object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {}
    if (projectId !== undefined) updateData.project_id = projectId
    if (isActive !== undefined) updateData.is_active = isActive

    // Update kiosk_accounts table
    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await serviceClient
        .from('kiosk_accounts')
        .update(updateData)
        .eq('id', id)

      if (updateError) {
        return NextResponse.json({ error: 'Gagal mengupdate akun kiosk' }, { status: 500 })
      }
    }

    // Reset password if requested
    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 })
      }
      const { error: pwError } = await serviceClient.auth.admin.updateUserById(
        currentAccount.auth_user_id,
        { password: newPassword }
      )
      if (pwError) {
        return NextResponse.json({ error: 'Gagal mengubah password' }, { status: 500 })
      }
    }

    // Audit log
    await createAuditLog(
      serviceClient,
      authContext.user.id,
      'kiosk_accounts',
      id,
      'UPDATED_KIOSK_ACCOUNT',
      `Mengubah akun kiosk ${currentAccount.username}`,
      { project_id: currentAccount.project_id, is_active: currentAccount.is_active },
      { ...updateData, ...(newPassword ? { password_changed: true } : {}) }
    )

    return NextResponse.json({ success: true, message: 'Akun kiosk berhasil diupdate' })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan sistem' }, { status: 500 })
  }
}

// DELETE: Delete kiosk account
export async function DELETE(req: NextRequest) {
  try {
    let authContext
    try {
      authContext = await verifyAuth(req)
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : ''
      const msg = errorMsg === 'FORBIDDEN' ? 'Akses ditolak' : 'Sesi tidak valid atau tidak ditemukan'
      return NextResponse.json({ error: msg }, { status: errorMsg === 'FORBIDDEN' ? 403 : 401 })
    }

    // Only super_admin can delete kiosk accounts
    if (authContext.profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Hanya Super Admin yang diizinkan menghapus akun kiosk' }, { status: 403 })
    }

    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID akun wajib diisi' }, { status: 400 })
    }

    const serviceClient = createServiceClient()

    // Fetch current kiosk account
    const { data: currentAccount, error: fetchError } = await serviceClient
      .from('kiosk_accounts')
      .select('id, auth_user_id, username, project_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchError || !currentAccount) {
      return NextResponse.json({ error: 'Akun kiosk tidak ditemukan' }, { status: 404 })
    }

    // Delete kiosk account (cascade will handle related records)
    const { error: deleteError } = await serviceClient
      .from('kiosk_accounts')
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json({ error: 'Gagal menghapus akun kiosk' }, { status: 500 })
    }

    // Delete profile
    await serviceClient
      .from('profiles')
      .delete()
      .eq('id', currentAccount.auth_user_id)

    // Delete auth user
    await serviceClient.auth.admin.deleteUser(currentAccount.auth_user_id)

    // Audit log
    await createAuditLog(
      serviceClient,
      authContext.user.id,
      'kiosk_accounts',
      id,
      'DELETED_KIOSK_ACCOUNT',
      `Menghapus akun kiosk ${currentAccount.username}`,
      { username: currentAccount.username, project_id: currentAccount.project_id },
      null
    )

    return NextResponse.json({ success: true, message: 'Akun kiosk berhasil dihapus' })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan sistem' }, { status: 500 })
  }
}
