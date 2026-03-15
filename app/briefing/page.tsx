'use client'

import { useEffect, useState } from 'react'
import { ChatLayout } from '@/components/chat-layout'
import { useIdentity } from '@/hooks/use-identity'

interface BriefingData {
  lastRunAt: number
  briefing: string
  summary: string
}

export default function BriefingPage() {
  useIdentity()
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/automation/briefing')
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((d: BriefingData) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Failed to load briefing')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const lastRun = data?.lastRunAt
    ? new Date(data.lastRunAt * 1000).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null

  return (
    <ChatLayout>
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <h1 className="text-2xl font-bold text-neutral-900 mb-1">Daily briefing</h1>
          <p className="text-sm text-neutral-500 mb-6">
            Latest run from automation (same as /today). Run with ENABLE_AUTOMATION=true to update.
          </p>

          {loading && (
            <div className="py-12 text-center text-neutral-500">Loading…</div>
          )}
          {error && (
            <div className="py-8 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-center">
              {error}
            </div>
          )}
          {!loading && !error && data && (
            <>
              {lastRun && (
                <p className="text-xs text-neutral-400 mb-4">Last run: {lastRun}</p>
              )}
              {data.summary && (
                <div className="mb-6 p-4 rounded-2xl bg-neutral-50 border border-neutral-100">
                  <p className="text-sm font-medium text-neutral-700">{data.summary}</p>
                </div>
              )}
              {data.briefing ? (
                <div className="rounded-2xl border border-neutral-100 bg-white p-6">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-800 leading-relaxed">
                    {data.briefing}
                  </pre>
                </div>
              ) : (
                <p className="text-neutral-500">No briefing content yet. Run automation once to populate.</p>
              )}
            </>
          )}
        </div>
      </div>
    </ChatLayout>
  )
}
