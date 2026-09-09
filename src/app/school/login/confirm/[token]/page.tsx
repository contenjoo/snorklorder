'use client';
import {use,useState} from 'react';
export default function LoginConfirm({params}:{params:Promise<{token:string}>}){
 const {token}=use(params);const [message,setMessage]=useState('이 브라우저에서 요청한 학교 관리자 로그인을 완료합니다.');const [busy,setBusy]=useState(false);
 async function confirm(){setBusy(true);try{const r=await fetch(`/api/school/login/verify/${token}`,{method:'POST'});const data=await r.json();if(r.ok)location.assign('/school');else setMessage(data.error);}catch{setMessage('연결에 실패했습니다.');}finally{setBusy(false);}}
 return <main className="mx-auto max-w-lg p-8"><h1 className="text-2xl font-bold">학교 관리자 로그인</h1><p className="my-6">{message}</p><button className="rounded bg-blue-600 p-3 text-white" disabled={busy} onClick={confirm}>로그인 확인</button><a href="/school/login" className="block mt-6 underline">새 로그인 링크 받기</a></main>;
}
