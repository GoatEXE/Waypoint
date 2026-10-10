import type { ActivityItem, CeoConversation, CeoLiveTurn, CeoMessage, CeoSendResponse } from './api';

export interface CeoState {
  sessionId: string | null;
  messages: CeoMessage[];
  loading: boolean;
  loadError: string | null;
  sending: boolean;
  sendError: string | null;
  pendingMessage: string | null;
  failedMessage: string | null;
  live: CeoLiveTurn | null;
  busyThreadId: string | null;
}

export const emptyCeoState: CeoState = {
  sessionId: null,
  messages: [],
  loading: false,
  loadError: null,
  sending: false,
  sendError: null,
  pendingMessage: null,
  failedMessage: null,
  live: null,
  busyThreadId: null,
};

export const cleanCeoMessage = (text: string) => text.trim();

export function createdBoardTask(items: ActivityItem[] | undefined): boolean {
  return (items || []).some(item => item.status === 'ok' && (item.name === 'kanban_create' || /\bkanban\s+create\b/.test(item.detail)));
}

export function ceoLoadStarted(state: CeoState): CeoState {
  return { ...state, loading: true, loadError: null };
}

function confirmedUserAndReply(user: CeoMessage, reply: CeoMessage) {
  if (user.status === 'outcome_unknown' || reply.status === 'outcome_unknown') return false;
  if (user.status === 'sent' || user.status === 'confirmed') return reply.status === 'confirmed';
  if (user.status === undefined) return reply.status === undefined || reply.status === 'confirmed';
  return false;
}

function hasConfirmedTurn(messages: CeoMessage[], attemptedText: string) {
  let latestUserIndex = -1;
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role === 'user' && message.text === attemptedText) latestUserIndex = i;
  }
  if (latestUserIndex < 0) return false;
  const reply = messages.slice(latestUserIndex + 1).find(message => message.role === 'ceo');
  return reply ? confirmedUserAndReply(messages[latestUserIndex], reply) : false;
}

export function ceoLoadSucceeded(state: CeoState, conversation: CeoConversation): CeoState {
  const failedMessage = state.failedMessage && !hasConfirmedTurn(conversation.messages, state.failedMessage)
    ? state.failedMessage
    : null;
  return {
    ...state,
    loading: false,
    loadError: null,
    sessionId: conversation.sessionId,
    messages: conversation.messages,
    live: conversation.live ?? null,
    busyThreadId: conversation.busyThreadId ?? null,
    pendingMessage: null,
    failedMessage,
    sendError: failedMessage ? state.sendError : null,
  };
}

export function ceoLiveUpdated(state: CeoState, conversation: CeoConversation): CeoState {
  return { ...state, live: conversation.live ?? null, busyThreadId: conversation.busyThreadId ?? null };
}

export function ceoLoadFailed(state: CeoState, error: string): CeoState {
  return { ...state, loading: false, loadError: error };
}

export function ceoSendStarted(state: CeoState, message: string): CeoState {
  return { ...state, sending: true, sendError: null, pendingMessage: message, failedMessage: null };
}

export function ceoSendSucceeded(state: CeoState, response: CeoSendResponse): CeoState {
  return { ...state, sending: false, sendError: null, pendingMessage: null, failedMessage: null, live: null, busyThreadId: null, sessionId: response.sessionId, messages: response.messages };
}

export function ceoSendFailed(state: CeoState, error: string): CeoState {
  return { ...state, sending: false, sendError: error, failedMessage: state.pendingMessage, pendingMessage: null, live: null };
}
