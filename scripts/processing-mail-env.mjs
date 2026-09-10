import { readFileSync } from 'node:fs';
/** Read only this operation's explicitly needed settings; never print credential values. */
export function loadProcessingSettings(path) {
 if(!path)return;
 const allow=new Set(['DATABASE_URL','GMAIL_USER','GMAIL_APP_PASSWORD','RECEIVER_FULFILLMENT_PAUSED']);
 for(const line of readFileSync(path,'utf8').split('\n')) {
  const at=line.indexOf('=');if(at<0)continue;
  const name=line.slice(0,at).trim();if(!allow.has(name))continue;
  const value=line.slice(at+1).trim().replace(/^['"]|['"]$/g,'');
  if(!process.env[name])process.env[name]=value;
 }
}
