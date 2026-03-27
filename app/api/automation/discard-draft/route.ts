/**
 * POST /api/automation/discard-draft — remove a reply draft from automation_briefing.json
 * (same effect as after a successful send, but without sending mail).
 */

import { NextRequest, NextResponse } from 'next/server'
import { removeDraftFromBriefingFile } from '@/lib/automation-briefing-file'

export async function POST(request: NextRequest) {
  let draftId: string
  let messageId: string | undefined
  try {
    const json = (await request.json()) as { draftId?: string; messageId?: string }
    draftId = json.draftId ?? ''
    messageId = json.messageId
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }
  if (!draftId) {
    return NextResponse.json({ ok: false, error: 'draftId required' }, { status: 400 })
  }

  const backendUrl = process.env.BACKEND_BRIEFING_URL?.trim()
  if (backendUrl) {
    try {
      const base = backendUrl.replace(/\/$/, '')
      const res = await fetch(`${base}/discard-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, messageId }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      return NextResponse.json(data, { status: res.ok ? 200 : res.status })
    } catch (e) {
      console.error('[automation/discard-draft] backend fetch failed:', e)
      return NextResponse.json({ ok: false, error: 'Failed to reach briefing server' }, { status: 502 })
    }
  }

  const ok = await removeDraftFromBriefingFile(draftId, messageId)
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'Draft not found or briefing file missing' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
