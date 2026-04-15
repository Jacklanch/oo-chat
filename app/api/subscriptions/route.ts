import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { agentDataJsonCandidates } from '@/lib/capstone-paths'

function subscriptionsFileCandidates(): string[] {
  return agentDataJsonCandidates('subscriptions.json')
}

export async function GET() {
  try {
    const candidates = subscriptionsFileCandidates()
    const SUBSCRIPTIONS_FILE = candidates.find((p) => existsSync(p))
    console.log('Subscription file candidates:', candidates)
    console.log('Using:', SUBSCRIPTIONS_FILE ?? '(none)')
    console.log('cwd:', process.cwd())
    if (!SUBSCRIPTIONS_FILE) {
      return NextResponse.json(
        { error: 'No subscription data found. Run "check subscriptions" in the chat first.' },
        { status: 404 }
      )
    }

    const content = readFileSync(SUBSCRIPTIONS_FILE, 'utf-8')
    const parsed = JSON.parse(content)

    return NextResponse.json(parsed)
  } catch (error) {
    console.error('Error reading subscription data:', error)
    return NextResponse.json(
      { error: 'Failed to read subscription data.' },
      { status: 500 }
    )
  }
}