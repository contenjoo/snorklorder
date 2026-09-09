'use client';
import Link from 'next/link';
import {use,useState} from 'react';
export default function Verify({params}:{params:Promise<{token:string}>}){
 const {token}=use(params);const [message,setMessage]=useState('본인 이메일이 맞으면 아래 버튼을 눌러 등록을 완료해 주세요.');const [busy,setBusy]=useState(false);const [done,setDone]=useState(false);
 async function verify(){setBusy(true);try{const r=await fetch('/api/register/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const d=await r.json();if(r.ok){setDone(true);setMessage(d.status==='approved'?'이메일 확인과 등록 승인이 완료됐습니다.':'이메일 확인이 완료됐습니다. 관리자 승인 후 이용할 수 있습니다.');}else setMessage(d.error);}catch{setMessage('연결에 실패했습니다. 다시 시도해 주세요.');}finally{setBusy(false);}}
 return <main className="mx-auto max-w-lg p-8"><h1 className="text-2xl font-bold">Snorkl 이메일 확인</h1><p className="my-6">{message}</p>{!done&&<button className="rounded bg-blue-600 p-3 text-white" disabled={busy} onClick={verify}>{busy?'확인 중…':'내 이메일 확인'}</button>}<Link className="block mt-6 underline" href="/">등록 화면으로</Link></main>;
}
