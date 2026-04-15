import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { agentDataJsonCandidates } from '@/lib/capstone-paths'

function unsubscribedPathCandidates(): string[] {
  return agentDataJsonCandidates('unsubscribed.json')
}

function resolveUnsubscribedFile(): string {
  const candidates = unsubscribedPathCandidates()
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

interface UnsubscribedEntry {
  sender_name: string
  sender_email: string
  category: string
  unsubscribed_at: number
}

function readUnsubscribed(): UnsubscribedEntry[] {
  const UNSUBSCRIBED_FILE = resolveUnsubscribedFile()
  if (!existsSync(UNSUBSCRIBED_FILE)) return []
  try {
    const content = readFileSync(UNSUBSCRIBED_FILE, 'utf-8')
    return JSON.parse(content)
  } catch {
    return []
  }
}

function writeUnsubscribed(entries: UnsubscribedEntry[]) {
  const UNSUBSCRIBED_FILE = resolveUnsubscribedFile()
  writeFileSync(UNSUBSCRIBED_FILE, JSON.stringify(entries, null, 2), 'utf-8')
}

// GET - return list of unsubscribed senders
export async function GET() {
  return NextResponse.json({ data: readUnsubscribed() })
}

// POST - mark a sender as unsubscribed
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sender_name, sender_email, category } = body

    if (!sender_email) {
      return NextResponse.json({ error: 'sender_email is required' }, { status: 400 })
    }

    const entries = readUnsubscribed()

    // Don't add duplicates
    if (entries.some(e => e.sender_email === sender_email)) {
      return NextResponse.json({ data: entries })
    }

    entries.push({
      sender_name: sender_name || '',
      sender_email,
      category: category || '',
      unsubscribed_at: Date.now() / 1000,
    })

    writeUnsubscribed(entries)
    return NextResponse.json({ data: entries })
  } catch (error) {
    console.error('Error saving unsubscribe:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}