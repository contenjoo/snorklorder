'use client';
import {useEffect,useState} from 'react';
interface LinkRow{kind:string;id:number;label:string;token_expires_at:string;}
export default function ConfirmationLinks(){
 const [rows,setRows]=useState<LinkRow[]>([]);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 async function load(){const r=await fetch('/api/admin/confirmation-links');if(r.ok)setRows(await r.json());else setMessage('목록을 불러오지 못했습니다.');}
 useEffect(()=>{void load();},[]);
 async function rotate(row:LinkRow){setBusy(true);try{const r=await fetch('/api/admin/confirmation-links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:row.kind,id:row.id})});const d=await r.json();if(!r.ok){setMessage(d.error);return;}setMessage(d.url);await load();}finally{setBusy(false);}}
 return <main className="p-6"><h1 className="text-2xl font-bold">확인 링크 관리</h1><p className="my-4">재발급하면 기존 링크가 만료됩니다. 메일은 자동 발송되지 않습니다.</p>{message&&<div className="my-4 break-all"><p>{message}</p>{message.startsWith('http')&&<button onClick={()=>navigator.clipboard.writeText(message)}>새 링크 복사</button>}</div>}<table className="w-full text-left"><thead><tr><th>유형 / 번호</th><th>대상</th><th>만료</th><th>관리</th></tr></thead><tbody>{rows.map(r=><tr key={`${r.kind}-${r.id}`}><td>{r.kind} #{r.id}</td><td>{r.label}</td><td>{new Date(r.token_expires_at).toLocaleString()}</td><td><button disabled={busy} onClick={()=>rotate(r)}>기존 링크 폐기 후 재발급</button></td></tr>)}</tbody></table></main>;
}
