import { currentAccount, sameOrigin } from '../lib/auth-db.js'
import { createOwnerHandler } from '../lib/penny-owner.js'

export default createOwnerHandler({ currentAccount, sameOrigin })
