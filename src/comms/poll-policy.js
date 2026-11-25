// Keep active chats responsive; reduce idle traffic and back off a failed widget.
export const POLL = Object.freeze({unread:30000, conversations:30000, activeConversation:4000, presence:45000, signedOut:120000, maxBackoff:300000})
export function nextUnreadDelay(previous,status){
 if(status>=200&&status<300)return POLL.unread
 if(status===401)return POLL.signedOut
 return Math.min(POLL.maxBackoff,Math.max(POLL.unread,previous)*2)
}
export function bridgeStateChanged(previous,next){return previous.open!==next.open||previous.visible!==next.visible}
