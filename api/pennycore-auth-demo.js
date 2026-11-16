import { currentAccount } from '../lib/auth-db.js'
import { createOAuthDemoHandler } from '../lib/pennycore-oauth-demo.js'
import { demoOAuthStore } from '../lib/pennycore-oauth-demo-store.js'
export default createOAuthDemoHandler({currentAccount,store:demoOAuthStore(process.env)})
