import fs from 'node:fs/promises';
import path from 'node:path';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function cgcFilePath(storage,key){
 if(typeof key!=='string'||!UUID.test(key))throw fail(409,'Unsafe file reference; deletion requires operator review');
 return path.join(path.resolve(storage),key);
}
export async function cgcDeletionManifest(client,storage,work){
 const owned=(await client.query('SELECT file_key,file_size FROM sarva.cgc_work_file WHERE work_id=$1',[work.id])).rows;
 const entries=new Map(owned.map(x=>[x.file_key,Number(x.file_size)]));
 for(const version of [work,work.published_snapshot])if(version?.file_key)entries.set(version.file_key,Number(version.file_size||0));
 const keys=[...entries.keys()];
 for(const key of keys)cgcFilePath(storage,key);
 if(keys.length){
  const shared=await client.query(`SELECT 1 FROM sarva.cgc_work WHERE id<>$1 AND (file_key=ANY($2::text[]) OR published_snapshot->>'file_key'=ANY($2::text[]))
   UNION ALL SELECT 1 FROM sarva.cgc_work_file WHERE work_id<>$1 AND file_key=ANY($2::text[]) LIMIT 1`,[work.id,keys]);
  if(shared.rowCount)throw fail(409,'A file is referenced by another submission; operator review is required');
 }
 let bytes=0,missing=0;
 for(const key of keys){try{const stat=await fs.lstat(cgcFilePath(storage,key));if(!stat.isFile())throw fail(409,'A stored file is not a regular file; operator review is required');bytes+=stat.size;}catch(e){if(e.code==='ENOENT')missing++;else throw e;}}
 return {keys,fileCount:keys.length,storedBytes:bytes,missingFiles:missing};
}
export function cleanupResult(row){return {id:row.id,complete:Boolean(row.completed_at),removedFiles:row.removed_files,remainingFiles:row.pending_keys.length,attempts:row.attempts};}

// Each worker owns one row lock. If a DB commit fails after unlink, retry treats ENOENT as success.
export async function purgeCgcDeletion(db,storage,id=null){
 const client=await db.connect();
 try{await client.query('BEGIN');
  const row=(await client.query(`SELECT * FROM sarva.cgc_deletion_cleanup WHERE completed_at IS NULL
   AND ($1::bigint IS NULL OR id=$1) AND ($1::bigint IS NOT NULL OR next_attempt_at<=now())
   ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,[id])).rows[0];
  if(!row){await client.query('COMMIT');return null;}
  const remaining=[];let removed=0;
  for(const key of row.pending_keys){try{await fs.unlink(cgcFilePath(storage,key));removed++;}catch(e){if(e.code==='ENOENT')removed++;else remaining.push(key);}}
  const updated=(await client.query(`UPDATE sarva.cgc_deletion_cleanup SET pending_keys=$2::jsonb,
   removed_files=removed_files+$3,attempts=attempts+1,last_error=$4,next_attempt_at=now()+interval '1 minute',
   completed_at=CASE WHEN jsonb_array_length($2::jsonb)=0 THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,
   [row.id,JSON.stringify(remaining),removed,remaining.length?'Stored files still need removal; retry cleanup.':''])).rows[0];
  await client.query('COMMIT');return cleanupResult(updated);
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export function startCgcDeletionWorker(db,storage){
 let running=false;
 const tick=async()=>{if(running)return;running=true;try{for(let i=0;i<5;i++){if(!await purgeCgcDeletion(db,storage))break;}}catch{console.warn('CGC file cleanup deferred; pending jobs will retry.');}finally{running=false;}};
 const timer=setInterval(tick,60000);timer.unref();void tick();return()=>clearInterval(timer);
}
