/** Trust only Gmail's ingress authentication block, never a sender-supplied pass string. */
export function authenticateBillingMail(mail:{from?:{value:{address?:string}[]};headerLines:readonly {key:string;line:string}[]},kind:'invoice'|'payment') {
 const from=mail.from?.value;
 if(from?.length!==1||!from[0].address)return false;
 const address=from[0].address.toLowerCase(); const domain=address.split('@')[1];
 if(kind==='invoice'?domain!=='snorkl.app':address!=='quickbooks@notification.intuit.com')return false;
 const lines=mail.headerLines;
 const boundaries=lines.map((h,i)=>({h,i})).filter(({h})=>h.key.toLowerCase()==='received'&&/\bby\s+mx\.google\.com\b/i.test(h.line));
 if(boundaries.length!==1)return false;
 const boundary=boundaries[0].i;
 const nextReceived=lines.findIndex((h,i)=>i>boundary&&h.key.toLowerCase()==='received');
 const auth=lines.filter((h,i)=>h.key.toLowerCase()==='authentication-results'&&i>boundary&&(nextReceived<0||i<nextReceived));
 if(auth.length!==1)return false;
 const value=auth[0].line.replace(/\r?\n\s+/g,' ');
 if(!/^Authentication-Results:\s*mx\.google\.com\s*;/i.test(value))return false;
 const methods=value.split(';').slice(1).map(s=>s.trim());
 const dmarc=methods.some(s=>/^dmarc=pass\b/i.test(s)&&new RegExp(`\\bheader\\.from=${domain.replaceAll('.','\\.')}($|\\s)`,'i').test(s));
 const signingDomain=kind==='payment'?'(?:notification\\.intuit\\.com|n\\.intuit\\.com)':'snorkl\\.app';
 const dkim=methods.some(s=>/^dkim=pass\b/i.test(s)&&new RegExp(`\\bheader\\.(?:d|i)=@?(?:[a-z0-9-]+\\.)*${signingDomain}($|\\s)`,'i').test(s));
 return dmarc&&dkim;
}
