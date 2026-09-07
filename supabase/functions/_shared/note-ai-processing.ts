import type { NoteAILease, createNoteAIJobs } from './note-ai-jobs.ts';
export function changedProfileSubjects(suggestions: Array<{suggestion_type:string;status:string;target_entity_id?:string|null;payload?:Record<string,unknown>}>): Array<string|null> {
 return [...new Set(suggestions.filter(s=>s.suggestion_type==='add_profile_entry' && s.status==='auto_applied_unreviewed' && s.target_entity_id).map(s=>typeof s.payload?.contact_id==='string'?s.payload.contact_id:null))];
}

interface Dependencies {
 isService: (authorization: string) => boolean;
 authenticate: (authorization: string) => Promise<string | null>;
 findNote: (noteId: string) => Promise<{user_id: string} | null>;
 jobs: Pick<ReturnType<typeof createNoteAIJobs>, 'enqueue' | 'getLease' | 'claimExecution' | 'reanalyze'>;
 isAdmin: (userId:string) => Promise<boolean>;
 execute: (lease: NoteAILease) => Promise<void>;
}
export async function handleNoteAIRequest(body: Record<string, any>, authorization: string, deps: Dependencies) {
 const reply = (status:number, body:Record<string,unknown>)=>({status,body});
 if (!authorization) return reply(401,{error:'Unauthorized'});
 if (typeof body.note_id !== 'string' || !body.note_id) return reply(400,{error:'note_id required'});
 const internal=deps.isService(authorization);
 if (body.execute === true || body.job_id || body.lease_id) {
  if (!internal) return reply(403,{error:'Service execution only'});
  if (!body.user_id || !body.job_id || !body.lease_id) return reply(400,{error:'Lease required'});
  const lease=await deps.jobs.getLease(body.user_id,body.job_id,body.lease_id);
  if (!lease || lease.pipeline !== 'analysis' || lease.note_id !== body.note_id || lease.user_id !== body.user_id) return reply(409,{error:'Invalid lease'});
  if (!await deps.jobs.claimExecution(lease)) return reply(409,{error:"Execution already admitted"});
  await deps.execute(lease);
  return reply(200,{ok:true,finished:true,processing:false});
 }
 const userId=internal ? null : await deps.authenticate(authorization);
 if (!internal && !userId) return reply(401,{error:'Unauthorized'});
 const deliberate=body.reason==='admin_reanalysis';
 const admin=deliberate && userId !== null && await deps.isAdmin(userId);
 if(deliberate && !admin)return reply(403,{error:'Verified administrator required'});
 const note=await deps.findNote(body.note_id);
 if (!note || (!internal && !admin && note.user_id !== userId)) return reply(403,{error:'Forbidden'});
 if(admin){const job=await deps.jobs.reanalyze(note.user_id,body.note_id,'analysis');return reply(202,{ok:true,queued:true,processing:false,job_id:job?.id,state:job?.state});}
 const job=await deps.jobs.enqueue(note.user_id,body.note_id,'analysis',body.reason==='manual'?'manual':'automatic');
 return reply(202,{ok:true,queued:true,processing:false,job_id:job?.id,state:job?.state ?? 'pending'});
}
