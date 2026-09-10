'use client';
import { useEffect, useState } from 'react';
type Item = {message_id:string;request_id:number|null;school_name:string|null;sender:string;received_at:string;excerpt:string;reason:string|null;evidence_reason:string;outcome:string|null;authenticated:boolean;source_verified:boolean;incomplete:boolean};
export default function ProcessingMailPage() {
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [items,setItems]=useState<Item[]>([]), [page,setPage]=useState(0), [hasMore,setHasMore]=useState(false), [message,setMessage]=useState(''), [busy,setBusy]=useState(false);
  async function load(current:number) {
    const res=await fetch(`/api/admin/processing-mail?page=${current}`,{cache:'no-store'});
    if(!res.ok)throw new Error('목록을 불러오지 못했습니다. 관리자 로그인 상태를 확인해 주세요.');
    const data=await res.json();setItems(data.items);setHasMore(data.hasMore);
  }
  useEffect(()=>{load(page).catch(e=>setMessage(e.message));},[page]);
  async function review(item:Item,action:'confirm'|'exclude') {
    const note=notes[`${item.message_id}:${item.request_id}`]?.trim();
    if(!note || note.length<3){setMessage('이 요청을 완료 또는 제외할 근거를 3자 이상 입력해 주세요.');return;}
    setBusy(true);
    try {
      const res=await fetch('/api/admin/processing-mail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:item.message_id,requestId:item.request_id,action,note})});
      const data=await res.json();if(!res.ok)throw new Error(data.error);
      setMessage(action==='confirm'?'처리 완료를 기록했습니다. 추가 메일은 발송하지 않았습니다.':'검토에서 제외했습니다.');await load(page);
    }catch(e){setMessage(e instanceof Error?e.message:'요청 실패');}finally{setBusy(false);}
  }
  const labels:Record<string,string>={applied:'완료 반영',already_confirmed:'이미 완료',review:'검토 필요',excluded:'검토 제외'};
  return <main className="mx-auto max-w-5xl p-6 space-y-5">
    <a href="/admin/accounts" className="underline">← 계정 요청</a><h1 className="text-xl font-semibold">처리 완료 메일 검토</h1>
    <p className="text-sm text-slate-600">직접 답장한 계정과 완료 내용이 일치한 요청만 자동 반영합니다. 이전 인용문에만 등장한 요청은 검토가 필요합니다.</p>
    <p role="status">{message}</p>
    {!items.length && <p>수집된 처리 완료 메일이 없습니다.</p>}
    {items.map((item,i)=><article key={`${item.message_id}:${item.request_id}:${i}`} className="border rounded-lg p-4 space-y-2">
      <h2 className="font-semibold">{item.request_id?`#${item.request_id} ${item.school_name}`:'대상 미확인'} · {labels[item.outcome||'']||'메일 확인 필요'}</h2>
      <p className="text-sm">{new Date(item.received_at).toLocaleString('ko-KR')} · {item.sender}</p>
      <blockquote className="whitespace-pre-wrap bg-slate-50 p-3">{item.excerpt}</blockquote>
      <p>{item.reason||item.evidence_reason}{item.incomplete?' · 선행 메일을 다시 수집합니다.':''}</p>
      <a className="underline text-sm" target="_blank" rel="noreferrer" href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`rfc822msgid:${item.message_id}`)}`}>근거 메일 열기</a>
      {item.outcome==='review'&&item.request_id&&<div className="space-y-2">
        <label className="block text-sm" htmlFor={`review-note-${i}`}>검토 근거 — #{item.request_id}</label>
        <textarea id={`review-note-${i}`} className="w-full rounded border p-2" maxLength={1000} value={notes[`${item.message_id}:${item.request_id}`]||''} onChange={e=>setNotes({...notes,[`${item.message_id}:${item.request_id}`]:e.target.value})} placeholder="추가로 확인한 완료 근거 또는 제외 사유" />
        <div className="flex gap-3">
        <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={busy||!item.authenticated||!item.source_verified||item.incomplete} onClick={()=>review(item,'confirm')}>이 요청 처리 완료</button>
        <button className="rounded border px-3 py-1" disabled={busy} onClick={()=>review(item,'exclude')}>검토 제외</button>
        </div>
      </div>}
    </article>)}
    <div className="flex gap-4"><button disabled={page===0||busy} onClick={()=>setPage(page-1)}>이전</button><span>{page+1}페이지</span><button disabled={!hasMore||busy} onClick={()=>setPage(page+1)}>다음</button></div>
  </main>;
}
