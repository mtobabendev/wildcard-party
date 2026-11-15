import { currentAccount, sameOrigin } from '../lib/auth-db.js'
import { createNexusMemoryHandler } from '../lib/nexus-memory-handler.js'
import { memoryStore } from '../lib/nexus-memory-db.js'
export default createNexusMemoryHandler({currentAccount,sameOrigin,store:memoryStore(process.env)})
