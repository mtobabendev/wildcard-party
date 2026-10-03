import { defineConfig } from '@neon/config/v1'

export default defineConfig({
  functions: {
    commsrelay: {
      name: 'COMMS relay',
      source: './functions/comms-relay.js',
      env: {
        COMMS_SIGNAL_SECRET: process.env.COMMS_SIGNAL_SECRET,
      },
    },
  },
})
