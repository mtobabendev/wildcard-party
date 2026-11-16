import {currentDeviceSession,liveDeviceSession} from '../lib/auth-db.js'
import {memoryStore} from '../lib/nexus-memory-db.js'
import {createDeviceHandler} from '../lib/nexus-device.js'
export default createDeviceHandler({currentDeviceSession,liveDeviceSession,store:memoryStore(process.env)})
