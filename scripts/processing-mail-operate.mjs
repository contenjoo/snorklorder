import { moduleLoader } from './processing-mail-loader.mjs';
import { loadProcessingSettings } from './processing-mail-env.mjs';
const args=process.argv.slice(2), envIndex=args.indexOf('--env-file');
if(envIndex>=0)loadProcessingSettings(args[envIndex+1]);
const apply=args.includes('--apply-222');
if(apply && process.env.PROCESSING_MAIL_APPLY!=='confirmed')throw new Error('Explicit scoped application authorization required');
if(apply)process.env.PROCESSING_MAIL_SYNC_ENABLED='true';
const load=moduleLoader();
const {fetchProcessingReplies}=load('@/lib/processing-mail-imap');
const {recordProcessingReply}=load('@/lib/processing-mail-sync');
try {
 const collected=await fetchProcessingReplies({newerThanDays:14,maxPerKind:40});
 console.log({scanned:collected.replies.length,incomplete:collected.incomplete});
 // The one-time live operation is scoped to today's exact, previously reviewed message.
 const replies=collected.replies.filter(r=>r.receivedAt>='2026-09-09T23:00:00Z' && r.receivedAt<='2026-09-10T00:00:00Z'
   && r.snapshots.some(s=>s.id===222));
 if(replies.length!==1)throw new Error('Expected exactly one reviewed reply; no changes applied');
 const reply=replies[0];
 const preview=await recordProcessingReply(reply,{dryRun:true,allowRequestIds:[222]});
 if(preview.plan.selected.length!==1 || preview.plan.selected[0]!==222 || !reply.authenticated)throw new Error('Reviewed reply no longer matches #222 exclusively');
 console.log({messageId:reply.messageId,receivedAt:reply.receivedAt,authenticated:reply.authenticated,sourceVerified:reply.sourceVerified,plan:preview.plan,items:preview.items});
 if(apply){const result=await recordProcessingReply(reply,{allowRequestIds:[222]});console.log({applied:result.items});}
} catch(error) {console.error(error instanceof Error?error.message:'Processing mail operation failed');process.exitCode=1;}
