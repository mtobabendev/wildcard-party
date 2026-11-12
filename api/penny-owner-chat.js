import { currentAccount, sameOrigin } from '../lib/auth-db.js'
import { clientIp, rateAllowed } from './penny.js'
import { createOwnerChatHandler } from '../lib/penny-core-owner-chat.js'

export default createOwnerChatHandler({ currentAccount, sameOrigin, rateAllowed, clientIp })
