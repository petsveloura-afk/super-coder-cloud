/**
 * When the owner wrote himself (from the inbox or his own phone) the agent stays out of the conversation until the
 * owner presses "return to agent" — 0 = never comes back by itself. A business that wants the agent to come back
 * after some silence chooses the time in the agent's setup (Takeover); that explicit choice is always honoured.
 * (Before: 30 minutes by default — the agent jumped back into chats a person had taken over.)
 */
export const DEFAULT_RESUME_MINUTES = 0;
