import {Router} from 'express';
import {cgcDeletionManifest,purgeCgcDeletion} from '../services/cgcDeletion.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const isId=v=>/^[1-9][0-9]{0,17}$/.test(String(v));
const attempt=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
async function platformAdmin(client,id){
 const row=(await client.query(`SELECT u.id FROM sarva.app_user u WHERE u.id=$1 AND u.is_active AND EXISTS
  (SELECT 1 FROM sarva.app_user_role ur JOIN sarva.auth_role r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='admin') FOR SHARE`,[id])).rows[0];
 if(!row)throw fail(403,'Platform administrator access is required for permanent deletion');
}
export function createCgcDeletionRouter({db,storage,auth,limit,locked,transaction,purgeFiles=purgeCgcDeletion}){
 const router=Router();
 const admin=(req,res,next)=>{if(!req.reviewUser.isAdmin)return res.status(403).json({message:'Platform administrator access required'});next();};
 router.get('/notices',auth,attempt(async(req,res)=>{
  const page=Number(req.query.page||1);if(!Number.isSafeInteger(page)||page<1||page>10000)throw fail(400,'Invalid page');
  const values=[req.reviewUser.id],total=(await db.query('SELECT count(*)::integer AS total FROM sarva.cgc_deletion_notice WHERE recipient_id=$1',values)).rows[0].total;
  const items=(await db.query(`SELECT n.id,n.submission_title,a.reason AS message,a.created_at,
   (c.completed_at IS NOT NULL) AS files_removed FROM sarva.cgc_deletion_notice n JOIN sarva.cgc_deletion_audit a ON a.id=n.audit_id
   JOIN sarva.cgc_deletion_cleanup c ON c.audit_id=a.id WHERE n.recipient_id=$1 ORDER BY n.id DESC LIMIT 20 OFFSET $2`,[...values,(page-1)*20])).rows;
  res.json({data:{items,total,page,pageSize:20}});
 }));
 router.get('/deletions',auth,admin,attempt(async(req,res)=>{
  const items=(await db.query(`SELECT c.id,a.work_id,a.file_count,a.file_bytes,a.created_at,c.removed_files,c.attempts,c.last_error
   FROM sarva.cgc_deletion_cleanup c JOIN sarva.cgc_deletion_audit a ON a.id=c.audit_id
   WHERE c.completed_at IS NULL ORDER BY c.id LIMIT 20`)).rows;
  res.json({data:{items}});
 }));
 router.post('/deletions/:id/retry',auth,admin,limit,attempt(async(req,res)=>{
  if(!isId(req.params.id))throw fail(400,'Invalid cleanup job');
  await transaction(c=>platformAdmin(c,req.reviewUser.id));
  const result=await purgeFiles(db,storage,req.params.id);
  res.status(result&&!result.complete?202:200).json({data:{cleanup:result,message:result?.complete?'Stored files permanently removed.':'Cleanup checked. Pending jobs retry automatically.'}});
 }));
 router.get('/:id/deletion-preview',auth,admin,attempt(async(req,res)=>{
  if(!isId(req.params.id))throw fail(404,'Submission not found');
  const preview=await transaction(async client=>{await platformAdmin(client,req.reviewUser.id);
   const work=(await client.query('SELECT * FROM sarva.cgc_work WHERE id=$1 FOR SHARE',[req.params.id])).rows[0];if(!work)throw fail(404,'Submission not found');
   const files=await cgcDeletionManifest(client,storage,work);
   return {id:work.id,title:work.title,revision:work.revision,fileCount:files.fileCount,storedBytes:files.storedBytes,missingFiles:files.missingFiles,hasSubmitter:Boolean(work.created_by)};
  });res.json({data:preview});
 }));
 router.post('/:id/permanent-delete',auth,admin,limit,attempt(async(req,res)=>{
  const {confirmation,message,revision}=req.body||{};
  if(!isId(req.params.id)||confirmation!=='DELETE'||typeof message!=='string'||message.trim().length<10||message.length>2000)throw fail(400,'Type DELETE and write a message of 10–2000 characters to the submitter');
  const receipt=await transaction(async client=>{
   await platformAdmin(client,req.reviewUser.id);
   const work=await locked(client,req.params.id,req.reviewUser,revision);
   await platformAdmin(client,req.reviewUser.id);
   const files=await cgcDeletionManifest(client,storage,work);
   const audit=(await client.query(`INSERT INTO sarva.cgc_deletion_audit(work_id,actor_id,reason,file_count,file_bytes)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,[work.id,req.reviewUser.id,message.trim(),files.fileCount,files.storedBytes])).rows[0];
   if(work.created_by)await client.query('INSERT INTO sarva.cgc_deletion_notice(recipient_id,audit_id,submission_title) VALUES($1,$2,$3)',[work.created_by,audit.id,work.title]);
   const job=(await client.query('INSERT INTO sarva.cgc_deletion_cleanup(audit_id,pending_keys) VALUES($1,$2::jsonb) RETURNING id',[audit.id,JSON.stringify(files.keys)])).rows[0];
   await client.query('DELETE FROM sarva.cgc_work_event WHERE work_id=$1',[work.id]);
   await client.query('DELETE FROM sarva.cgc_work WHERE id=$1',[work.id]);
   return {jobId:job.id,notified:Boolean(work.created_by)};
  });
  let cleanup=null;try{cleanup=await purgeFiles(db,storage,receipt.jobId);}catch{ /* Durable cleanup job remains queued. */ }
  const complete=Boolean(cleanup?.complete);
  res.status(complete?200:202).json({data:{deleted:true,filesRemoved:complete,submitterNotified:receipt.notified,cleanupJobId:receipt.jobId,
   message:complete?'Submission and tracked uploaded files permanently deleted.':'Submission permanently deleted; file removal is pending and will retry automatically.'}});
 }));
 return router;
}
