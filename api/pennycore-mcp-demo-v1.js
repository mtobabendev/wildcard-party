// The public unauthenticated fixture has been retired. Do not redirect to the secure tool.
export default function retiredDemo(req,res){
 res.setHeader('Cache-Control','no-store')
 res.setHeader('X-Content-Type-Options','nosniff')
 return res.status(410).json({error:'Public PennyCore demo retired. Use the authorized PennyCore connection.'})
}
