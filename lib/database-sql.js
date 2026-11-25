import { neon } from '@neondatabase/serverless'
import pg from 'pg'
const {Pool}=pg
const pools=new Map()

// Select the wire protocol by destination, never by retrying writes elsewhere.
export function databaseTransport(connectionString){
 const url=new URL(connectionString)
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Invalid PostgreSQL URL protocol.')
 return /(^|\.)neon\.tech$/i.test(url.hostname)?'neon-http':'postgres'
}

// Preserve parameter binding. Never concatenate interpolated user values into SQL.
export function postgresTag(query){
 return async (strings,...values)=>{
  if(!Array.isArray(strings)||!Array.isArray(strings.raw))throw new TypeError('Database SQL requires a tagged template.')
  const text=strings.reduce((sql,part,i)=>sql+(i?'$'+i:'')+part,'')
  const result=await query(text,values)
  return result.rows
 }
}
export function postgresPoolOptions(connectionString){
 const url=new URL(connectionString)
 const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname)
 // Keep certificate verification on for remote providers. A local connection may explicitly disable TLS.
 if(!loopback){
  for(const key of ['sslmode','ssl','sslcert','sslkey','sslrootcert','uselibpqcompat'])url.searchParams.delete(key)
  url.searchParams.set('sslmode','verify-full')
 }
 return {connectionString:url.toString(),max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:10000,allowExitOnIdle:true}
}
export function databaseSql(connectionString){
 if(databaseTransport(connectionString)==='neon-http')return neon(connectionString)
 let pool=pools.get(connectionString)
 if(!pool){
  pool=new Pool(postgresPoolOptions(connectionString))
  pool.on('error',()=>console.error('Idle database connection error'))
  pools.set(connectionString,pool)
 }
 return postgresTag((text,values)=>pool.query(text,values))
}
