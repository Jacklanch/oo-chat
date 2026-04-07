/**
 * @purpose Active chat session page — renders conversation UI with full agent interaction (messages, tools, approvals, modes)
 * @llm-note
 *   Dependencies: imports from [components/chat/index.ts (Chat, useAgentSDK, ModeStatusBar, PlanModeBanner, UlwModeBanner), components/chat/types.ts (UI, ApprovalMode), components/chat-layout.tsx (ChatLayout), store/chat-store.ts (useChatStore), hooks/use-identity.ts (useIdentity), hooks/use-agent-info.ts (useAgentInfo, shortAddress)] | imported by none (Next.js dynamic route page) | no test files
 *   Data flow: reads address + sessionId from URL params → useAgentSDK connects to agent via WebSocket → receives ChatItem[] (ui) streamed from agent → syncs UI back to chat-store for persistence → renders Chat component with all interaction handlers
 *   State/Effects: reads/writes conversations in zustand chat-store (persist to localStorage) | useAgentSDK manages WebSocket connection to agent | useIdentity ensures Ed25519 keypair exists | useAgentInfo polls agent /info endpoint every 30s | redirects to /[address] if no conversation found after store hydration
 *   Integration: exposes nothing (leaf page component) | consumes pendingMessage from chat-store (set by agent landing page before navigation) | passes mode from URL query params (?mode=ulw&turns=5) to useAgentSDK.setMode | provides handleReconnect via checkSession() for post-refresh reconnection
 *   Performance: displayUI memo avoids re-renders when hookUI unchanged | consumedRef prevents double-send of pending message | shouldRedirect deferred until _hasHydrated to avoid flash redirect on refresh
 *   Errors: connection errors stored in connectionError state → shown in ModeStatusBar with retry button | session expiry detected via checkSession() → shows error message
 *
 * URL Structure:
 *   /[address]/[sessionId]?mode=safe|plan|accept_edits|ulw&turns=N
 *   - address: agent's public key (0x...)
 *   - sessionId: UUID identifying the conversation session
 *   - mode: initial approval mode (optional, default: safe)
 *   - turns: ULW autonomous turns limit (optional)
 *
 * Lifecycle:
 *   1. Page mounts → useIdentity ensures keypair → useAgentSDK connects
 *   2. If pendingMessage in store (from landing page) → consume + send immediately
 *   3. Agent streams UI events → hookUI updates → syncs to chat-store
 *   4. On page refresh → store hydrates → finds conversation → renders stored UI
 *      → useAgentSDK.checkSession polls to detect if agent still running
 *   5. If no conversation found after hydration → redirect to agent landing
 *
 * File Relationships:
 *   app/
 *   ├── [address]/
 *   │   ├── page.tsx              # Agent landing page (creates session, navigates here)
 *   │   └── [sessionId]/
 *   │       └── page.tsx          # THIS FILE - active chat session
 *   components/chat/
 *   ├── use-agent-sdk.ts          # WebSocket connection + state management
 *   ├── chat.tsx                  # Main chat UI component
 *   ├── mode-indicator.tsx        # ModeStatusBar (safe/plan/ulw indicator + reconnect)
 *   └── mode-switcher.tsx         # PlanModeBanner, UlwModeBanner
 */
'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Chat, useAgentSDK, ModeStatusBar, PlanModeBanner, UlwModeBanner } from '@/components/chat'
import type { UI, ApprovalMode } from '@/components/chat/types'
import { ChatLayout } from '@/components/chat-layout'
import { useChatStore } from '@/store/chat-store'
import { useIdentity } from '@/hooks/use-identity'
import { shortAddress, useAgentInfo } from '@/hooks/use-agent-info'

const SUGGESTIONS = [
  '/today',
  '/inbox',
  'What emails need my attention?',
  'Schedule a meeting with...',
]

const SLASH_COMMANDS = [
  { id: '/today',      prefix: '📅', label: 'Daily email briefing by priority' },
  { id: '/events',     prefix: '🗓️', label: 'Extract events from emails [days]' },
  { id: '/inbox',      prefix: '📥', label: 'Show recent emails [n]' },
  { id: '/search',     prefix: '🔍', label: 'Search emails <query>' },
  { id: '/unanswered', prefix: '⏳', label: 'Find emails pending your reply' },
  { id: '/contacts',   prefix: '👥', label: 'View your contacts' },
  { id: '/sync',       prefix: '🔄', label: 'Sync contacts from Gmail' },
  { id: '/init',       prefix: '🗄️', label: 'Initialize CRM database (3-5 min)' },
  { id: '/init-status', prefix: '📊', label: 'Check CRM init progress' },
  { id: '/identity',   prefix: '🆔', label: 'Show your email identity' },
]

export default function ChatSessionPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const address = params.address as string
  const sessionId = params.sessionId as string

  // Read initial mode from URL (stateless, simple)
  const initialMode = (searchParams.get('mode') as ApprovalMode) || 'safe'
  const initialTurns = searchParams.get('turns') ? parseInt(searchParams.get('turns')!) : null

  const {
    agents,
    addAgent,
    conversations,
    createConversation,
    selectConversation,
    updateTitle,
    updateUI,
    consumePendingMessage,
    _hasHydrated,
  } = useChatStore()

  useIdentity()

  const agentInfoMap = useAgentInfo([address])
  const skills = agentInfoMap[address]?.skills

  // Add agent if not in list
  useEffect(() => {
    if (address && !agents.includes(address)) {
      addAgent(address)
    }
  }, [address, agents, addAgent])

  // Find the conversation
  const conversation = useMemo(
    () => conversations.find(c => c.sessionId === sessionId),
    [conversations, sessionId]
  )

  // Set active session when route changes
  useEffect(() => {
    if (sessionId) {
      selectConversation(sessionId)
    }
  }, [sessionId, selectConversation])

  const {
    ui: hookUI,
    isLoading,
    elapsedTime,
    pendingAskUser,
    pendingApproval,
    pendingOnboard,
    pendingUlwTurnsReached,
    pendingPlanReview,
    sessionState,
    mode,
    ulwTurnsRemaining,
    send,
    respondToAskUser,
    respondToApproval,
    submitOnboard,
    respondToUlwTurnsReached,
    respondToPlanReview,
    setMode,
    checkSessionStatus,
    reconnect,
  } = useAgentSDK({
    agentAddress: address,
    sessionId,
    onError: (error) => setConnectionError(error),
  })

  // Consume pending message and apply initial mode from URL
  const consumedRef = useRef<string | null>(null)
  const [sendingInitial, setSendingInitial] = useState(false)

  // Connection error state for retry functionality
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [lastMessage, setLastMessage] = useState<string>('')

  // Track /init command state for long-running CRM initialization
  const [isInitRunning, setIsInitRunning] = useState(false)
  // Confirmation flow before running /init
  const [pendingInitConfirm, setPendingInitConfirm] = useState(false)

  useEffect(() => {
    if (consumedRef.current === sessionId) return
    consumedRef.current = sessionId

    // Apply mode from URL FIRST (before sending message)
    if (initialMode !== 'safe') {
      setMode(initialMode, initialTurns ? { turns: initialTurns } : undefined)
    }

    // Then send the pending message
    const pendingMessage = consumePendingMessage()
    if (pendingMessage) {
      setSendingInitial(true)
      send(pendingMessage)
      setSendingInitial(false)
    }
  }, [sessionId, initialMode, initialTurns, consumePendingMessage, send, setMode])

  // Use stored UI if available, otherwise use hook UI
  // When /init is running, inject a warning message after the user's command
  const displayUI = useMemo((): UI[] => {
    const raw = hookUI.length > 0 ? (hookUI as UI[]) : (conversation?.ui || [])
    // Strip stale "running" thinking items when the agent isn't actually processing —
    // these are leftovers from a session interrupted by navigation
    const base = isLoading ? raw : raw.filter(
      item => !(item.type === 'thinking' && 'status' in item && item.status === 'running')
    )
    if (!isInitRunning) return base

    // Find the /init user message and inject a warning after it
    const initIndex = [...base].reverse().findIndex(
      item => item.type === 'user' && 'content' in item && item.content.trim() === '/init'
    )
    if (initIndex === -1) return base

    const insertAt = base.length - initIndex
    const warning: UI = {
      id: 'init-warning',
      type: 'agent',
      content: '**Initializing CRM database** — this scans your emails and builds contact profiles. It typically takes **3-5 minutes**.\n\nThis runs on the server, so you can navigate away safely. Use **/init-status** to check progress.',
    } as UI

    return [...base.slice(0, insertAt), warning, ...base.slice(insertAt)]
  }, [hookUI, conversation?.ui, isInitRunning])

  // Clear init running state once the immediate response arrives
  useEffect(() => {
    if (!isLoading && isInitRunning) {
      setIsInitRunning(false)
    }
  }, [isLoading, isInitRunning])

  // Sync UI changes back to store
  useEffect(() => {
    if (sessionId && hookUI.length > 0) {
      updateUI(sessionId, hookUI as UI[])

      const firstUser = hookUI.find(e => e.type === 'user')
      if (firstUser && 'content' in firstUser) {
        updateTitle(sessionId, firstUser.content)
      }
    }
  }, [sessionId, hookUI, updateUI, updateTitle])

  const handleSend = useCallback((content: string, images?: string[]) => {
    // Intercept /init to show confirmation first
    if (content.trim() === '/init') {
      setPendingInitConfirm(true)
      return
    }
    if (!conversation) {
      createConversation(sessionId, address)
    }
    setLastMessage(content)
    setConnectionError(null)
    send(content, images)
  }, [conversation, sessionId, address, createConversation, send])

  const handleInitConfirm = useCallback(() => {
    setPendingInitConfirm(false)
    if (!conversation) {
      createConversation(sessionId, address)
    }
    setLastMessage('/init')
    setConnectionError(null)
    setIsInitRunning(true)
    send('/init')
  }, [conversation, sessionId, address, createConversation, send])

  const handleInitCancel = useCallback(() => {
    setPendingInitConfirm(false)
  }, [])

  const handleReconnect = useCallback(() => {
    setConnectionError(null)
    reconnect()
  }, [reconnect])

  // Redirect to agent landing if no conversation and no pending messages
  // Only after store has hydrated from localStorage — avoids redirect on refresh
  const shouldRedirect = _hasHydrated && !conversation && hookUI.length === 0
  useEffect(() => {
    if (shouldRedirect) {
      router.replace(`/${address}`)
    }
  }, [shouldRedirect, router, address])

  if (shouldRedirect) {
    return null
  }

  const agentLabel = shortAddress(address)
  const isUlwActive = mode === 'ulw'

  return (
    <ChatLayout>
      <div className="flex flex-col flex-1 min-h-0 relative">
        {/* Plan mode banner */}
        {mode === 'plan' && (
          <PlanModeBanner onExit={() => setMode('safe')} />
        )}

        {/* ULW mode banner */}
        {isUlwActive && (
          <UlwModeBanner turnsRemaining={ulwTurnsRemaining} onExit={() => setMode('safe')} />
        )}

        {/* /init confirmation dialog */}
        {pendingInitConfirm && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 backdrop-blur-sm">
            <div className="mx-4 max-w-md rounded-xl border border-amber-200 bg-white p-6 shadow-lg">
              <h3 className="text-base font-semibold text-neutral-900 mb-2">Initialize CRM Database</h3>
              <div className="space-y-3 text-sm text-neutral-600">
                <p>
                  This will scan your emails and build contact profiles. It typically takes <strong className="text-neutral-800">3-5 minutes</strong> on the <strong className="text-neutral-800">first</strong> build.
                </p>
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
                  <strong>Warning:</strong> If you already have contacts saved, this will overwrite all existing contact data.
                </div>
                <p>You can navigate away — the process runs on the server and will complete in the background.</p>
              </div>
              <div className="mt-5 flex gap-3 justify-end">
                <button
                  onClick={handleInitCancel}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleInitConfirm}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 transition-colors"
                >
                  Proceed
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Chat with mode status bar (ULW toggle integrated) */}
        <Chat
          ui={displayUI}
          onSend={handleSend}
          isLoading={isLoading || sendingInitial}
          elapsedTime={elapsedTime}
          suggestions={SUGGESTIONS}
          slashCommands={SLASH_COMMANDS}
          emptyStateTitle="Welcome to oo-chat"
          emptyStateDescription={`Talking to ${agentLabel}`}
          pendingAskUser={pendingAskUser}
          onAskUserResponse={respondToAskUser}
          pendingApproval={pendingApproval}
          onApprovalResponse={respondToApproval}
          pendingOnboard={pendingOnboard}
          onOnboardSubmit={submitOnboard}
          pendingUlwTurnsReached={pendingUlwTurnsReached}
          onUlwTurnsReachedResponse={respondToUlwTurnsReached}
          pendingPlanReview={pendingPlanReview}
          onPlanReviewResponse={respondToPlanReview}
          sessionState={sessionState}
          statusBar={
            <ModeStatusBar
              mode={mode}
              onModeChange={setMode}
              disabled={false}
              ulwTurnsRemaining={ulwTurnsRemaining}
              sessionState={sessionState}
              isLoading={isLoading}
              connectionError={isInitRunning ? null : connectionError}
              onRetry={lastMessage && !isInitRunning ? () => handleSend(lastMessage) : undefined}
              onReconnect={handleReconnect}
            />
          }
          connectionError={isInitRunning ? null : connectionError}
          onRetry={lastMessage && !isInitRunning ? () => handleSend(lastMessage) : undefined}
          skills={skills}
        />
      </div>
    </ChatLayout>
  )
}
