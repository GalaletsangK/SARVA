import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {createReviewIssuesRouter} from '../src/routes/reviewIssues.js';
import {createUserAdminRouter} from '../src/routes/userAdmin.js';
import {pool} from '../src/db/pool.js';
import {createCgcWorkRouter,validateFile,validateWork} from '../src/routes/cgcWork.js';
if(process.env.CGC_TEST!=='synthetic-only')throw Error('Use only isolated synthetic database');
const prefix='cgc-'+crypto.randomUUID(),store=await fs.mkdtemp(path.join(os.tmpdir(),'cgc-test-'));let owner,other,admin,cgcAdmin,viewer,id;
const token=sub=>{const data=Buffer.from(JSON.stringify({sub:String(sub),roles:['admin'],exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return data+'.'+crypto.createHmac('sha256',process.env.AUTH_SECRET).update(data).digest('base64url');};
const app=express();app.use(express.json());app.use('/api',createCgcWorkRouter(pool,store));app.use('/api',createUserAdminRouter());app.use('/api',createReviewIssuesRouter(pool));
const failing={query:pool.query.bind(pool),connect:async()=>{const c=await pool.connect();return {release:()=>c.release(),query:(sql,args)=>String(sql).startsWith('INSERT INTO sarva.cgc_work_event')?Promise.reject(Error('Synthetic audit failure')):c.query(sql,args)};}};app.use('/failure',createCgcWorkRouter(failing,store));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port+'/api/cgc/work';
const draft={title:prefix+' water data',description:'Synthetic water data for testing approvals.',centres:['ufs'],kind:'dataset',year:2025,authors:'Synthetic contributor',licence:'CC BY 4.0',sourceUrl:'',dataAccess:'not-stated'};
const call=(who,suffix='',method='GET',body)=>fetch(base+suffix,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+token(who)}:{})},...(body?{body:JSON.stringify(body)}:{})});
const upload=(who,revision,name='sample.csv',body='station,rainfall\nA,10\n')=>fetch(base+'/'+id+'/file',{method:'POST',headers:{Authorization:'Bearer '+token(who),'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name),'X-Work-Revision':String(revision)},body});
before(async()=>{for(const name of ['owner','other','admin','cgcAdmin','viewer']){const uid=(await pool.query("INSERT INTO sarva.app_user(email,display_name,password_hash,password_salt) VALUES($1,$2,'not-login','not-login') RETURNING id",[prefix+name+'@example.invalid','Synthetic '+name])).rows[0].id;await pool.query('INSERT INTO sarva.app_user_role(user_id,role_id) SELECT $1,id FROM sarva.auth_role WHERE name=$2',[uid,name==='admin'?'admin':name==='cgcAdmin'?'cgc-admin':name==='viewer'?'viewer':'cgc-user']);if(name==='owner')owner=uid;else if(name==='other')other=uid;else if(name==='admin')admin=uid;else if(name==='cgcAdmin')cgcAdmin=uid;else viewer=uid;}});
after(async()=>{await pool.query('DELETE FROM sarva.cgc_member_preference WHERE user_id=ANY($1::bigint[])',[[owner,other,admin,cgcAdmin,viewer]]);await pool.query('DELETE FROM sarva.cgc_work_event WHERE work_id IN(SELECT id FROM sarva.cgc_work WHERE created_by=ANY($1::bigint[]))',[[owner,other,admin,cgcAdmin,viewer]]);await pool.query('DELETE FROM sarva.cgc_work WHERE created_by=ANY($1::bigint[])',[[owner,other,admin,cgcAdmin,viewer]]);await pool.query('DELETE FROM sarva.app_user WHERE id=ANY($1::bigint[])',[[owner,other,admin,cgcAdmin,viewer]]);await fs.rm(store,{recursive:true,force:true});await new Promise(r=>server.close(r));await pool.end();});
test('file and metadata validation reject executable/HTML/invalid files and unsafe URLs',()=>{
 for(const [data,name]of [['hi','evil.html'],['<html>bad','bad.csv'],['notpdf','bad.pdf'],['a','../test.csv'],['{bad','test.json'],['{}','test.geojson']])assert.throws(()=>validateFile(Buffer.from(data),name));
 assert.throws(()=>validateFile(Buffer.alloc(100*1024*1024+1),'large.csv'));
 assert.throws(()=>validateWork({...draft,sourceUrl:'javascript:alert(1)'}));assert.throws(()=>validateWork({...draft,centres:['other']}));assert.equal(validateFile(Buffer.from('a,b\n1,2'),'good.csv'),'text/csv');
});
test('anonymous reads curated work but cannot submit; no fabricated dataset seeds',async()=>{
 const r=await call(null);assert.equal(r.status,200);const d=(await r.json()).data;assert.ok(d.total>=8);assert.ok(d.items.every(x=>x.status==='published'&&!('file_key'in x)&&!('created_by'in x)));assert.equal((await call(null,'','POST',draft)).status,401);assert.equal((await call(other,'/review')).status,403);
});
test('submission is private and only its owner or admin can upload',async()=>{
 const r=await call(owner,'','POST',draft);assert.equal(r.status,201);const d=(await r.json()).data;id=d.id;assert.equal(d.status,'pending');assert.equal((await call(null,'?search='+prefix).then(r=>r.json())).data.total,0);assert.equal((await call(other,'/mine?search='+prefix).then(r=>r.json())).data.total,0);assert.equal((await upload(other,1)).status,404);assert.equal((await call(other,'/'+id+'/content','POST',{...draft,revision:1})).status,404);
 assert.equal((await upload(owner,1)).status,200);assert.equal((await call(null,'/'+id+'/file')).status,404);assert.equal((await call(other,'/'+id+'/file')).status,404);assert.equal((await call(owner,'/'+id+'/file')).status,200);assert.equal((await upload(owner,1)).status,409);
});
test('review checks actual database role and revision; approval enables public download',async()=>{
 assert.equal((await call(owner,'/'+id+'/review','POST',{revision:2,status:'published',note:'Approved'})).status,403);assert.equal((await call(admin,'/'+id+'/review','POST',{revision:2,status:'published',note:''})).status,400);
 const r=await call(admin,'/'+id+'/review','POST',{revision:2,status:'published',note:'File and sharing licence checked'});assert.equal(r.status,200);
 const file=await call(null,'/'+id+'/file');assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/attachment/);assert.equal(file.headers.get('x-content-type-options'),'nosniff');assert.equal(await file.text(),'station,rainfall\nA,10\n');
 assert.equal((await call(null,'?centre=ufs&kind=dataset&search='+prefix).then(r=>r.json())).data.total,1);
 assert.equal((await call(admin,'/'+id+'/review','POST',{revision:2,status:'published',note:'Stale request'})).status,409);
});
test('published file stays public while its replacement is pending',async()=>{
 assert.equal((await upload(owner,3,'updated.csv','x,y\n1,2')).status,200);const previous=await call(null,'/'+id+'/file');assert.equal(previous.status,200);assert.equal(await previous.text(),'station,rainfall\nA,10\n');assert.equal((await call(null,'?search='+prefix).then(r=>r.json())).data.total,1);assert.equal((await fs.readdir(store)).length,2);
 const h=await call(owner,'/'+id+'/history');assert.equal(h.status,200);assert.equal((await h.json()).data.length,4);assert.equal((await call(other,'/'+id+'/history')).status,404);
});
test('request changes, edit, publish and archive retain an audit trail',async()=>{
 assert.equal((await call(admin,'/'+id+'/review','POST',{revision:4,status:'changes-requested',note:'Please clarify the citation'})).status,200);
 assert.equal((await call(owner,'/'+id+'/content','POST',{...draft,citation:'Synthetic citation',revision:5})).status,200);
 assert.equal((await call(admin,'/'+id+'/review','POST',{revision:6,status:'published',note:'Citation checked'})).status,200);
 assert.equal((await call(admin,'/'+id+'/review','POST',{revision:7,status:'archived',note:'Synthetic example retired'})).status,200);assert.equal((await call(null,'/'+id+'/file')).status,404);assert.equal((await call(owner,'/'+id+'/file')).status,200);
});
test('failed audit insert rolls back the work and keeps upload storage unchanged',async()=>{
 const before=(await pool.query('SELECT count(*)::integer AS n FROM sarva.cgc_work WHERE created_by=$1',[owner])).rows[0].n;
 const r=await fetch(base.replace('/api/','/failure/'),{method:'POST',headers:{Authorization:'Bearer '+token(owner),'Content-Type':'application/json'},body:JSON.stringify(draft)});assert.equal(r.status,500);
 assert.equal((await pool.query('SELECT count(*)::integer AS n FROM sarva.cgc_work WHERE created_by=$1',[owner])).rows[0].n,before);
});
test('oversize and spoofed uploads fail without replacing the previous file',async()=>{
 assert.equal((await upload(owner,8,'bad.pdf','not a PDF')).status,400);
 assert.equal((await upload(owner,8,'large.csv',Buffer.alloc(100*1024*1024+1,65))).status,413);
 assert.equal((await fs.readdir(store)).length,2);
});
test('draft lifecycle, saved affiliation and exact 100 MB uploads remain private until approved',async()=>{
 const profile=await call(owner,'/profile','POST',{centre:'ufs'});assert.equal(profile.status,200);
 assert.equal((await call(owner,'/profile').then(r=>r.json())).data.centre,'ufs');
 assert.equal((await call(other,'/profile').then(r=>r.json())).data.centre,'');
 assert.equal((await call(viewer,'/profile','POST',{centre:'ufs'})).status,403);
 const created=await call(owner,'','POST',{...draft,title:prefix+' saved draft',description:'',intent:'draft'});assert.equal(created.status,201);let work=(await created.json()).data;const wid=work.id;
 const post=(who,suffix,body)=>call(who,'/'+wid+suffix,'POST',body);
 assert.equal(work.status,'draft');assert.equal((await post(admin,'/review',{status:'published',note:'Cannot bypass submission',revision:work.revision})).status,400);
 assert.equal((await post(owner,'/submit',{revision:work.revision})).status,400);
 const bytes=Buffer.alloc(100*1024*1024,32);bytes.write('%PDF-1.4');
 const uploadResponse=await fetch(base+'/'+wid+'/file',{method:'POST',headers:{Authorization:'Bearer '+token(owner),'Content-Type':'application/octet-stream','X-File-Name':'large.pdf','X-Work-Revision':String(work.revision)},body:bytes});
 assert.equal(uploadResponse.status,200);work=(await uploadResponse.json()).data;assert.equal(work.file_size,100*1024*1024);assert.equal(work.status,'draft');
 assert.equal((await call(null,'/'+wid+'/file')).status,404);assert.equal((await call(other,'/'+wid+'/file')).status,404);
 let response=await post(owner,'/content',{...draft,title:prefix+' saved draft',intent:'draft',revision:work.revision});assert.equal(response.status,200);work=(await response.json()).data;
 response=await post(owner,'/submit',{revision:work.revision});assert.equal(response.status,200);work=(await response.json()).data;
 response=await post(admin,'/review',{status:'published',note:'Synthetic licence and file verified',revision:work.revision});assert.equal(response.status,200);work=(await response.json()).data;
 const publishedFile=await call(null,'/'+wid+'/file');assert.equal(publishedFile.status,200);assert.equal((await publishedFile.arrayBuffer()).byteLength,100*1024*1024);
 response=await post(owner,'/content',{...draft,title:prefix+' private replacement',description:'Replacement not approved yet.',intent:'draft',revision:work.revision});assert.equal(response.status,200);work=(await response.json()).data;
 const publicWork=(await call(null,'?search='+prefix+' saved draft').then(r=>r.json())).data.items.find(x=>x.id===wid);assert.equal(publicWork.title,prefix+' saved draft');assert.ok(!('published_snapshot'in publicWork));
 assert.equal((await call(null,'?search='+prefix+' private replacement').then(r=>r.json())).data.total,0);
 response=await post(owner,'/submit',{revision:work.revision});work=(await response.json()).data;
 response=await post(admin,'/review',{status:'changes-requested',note:'Keep approved content visible',revision:work.revision});assert.equal(response.status,200);work=(await response.json()).data;
 assert.equal((await call(null,'?search='+prefix+' saved draft').then(r=>r.json())).data.total,1);
 assert.equal((await post(admin,'/review',{status:'archived',note:'Synthetic archive',revision:work.revision})).status,200);
 assert.equal((await call(null,'/'+wid+'/file')).status,404);
});

test('CGC-specific roles cannot grant platform administration; viewers cannot submit',async()=>{
 assert.equal((await call(viewer,'','POST',draft)).status,403);
 await pool.query("INSERT INTO sarva.app_user_role(user_id,role_id) SELECT $1,id FROM sarva.auth_role WHERE name='contributor' ON CONFLICT DO NOTHING",[viewer]);
 assert.equal((await call(viewer,'','POST',draft)).status,403,'generic contributor is not a CGC contributor');
 const feedback=await fetch(base.replace('/cgc/work','/review/issues'),{headers:{Authorization:'Bearer '+token(cgcAdmin)}});assert.equal(feedback.status,200);assert.equal((await feedback.json()).data.isAdmin,false,'CGC reviewer has no global feedback administration');
 const assignments=await fetch(base.replace('/cgc/work','/review/issues/assignment-options'),{headers:{Authorization:'Bearer '+token(cgcAdmin)}});assert.equal(assignments.status,403);
 assert.equal((await call(viewer,'/review')).status,403);
 assert.equal((await call(cgcAdmin,'/review')).status,200);
 const users=await fetch(base.replace('/cgc/work','/admin/users'),{headers:{Authorization:'Bearer '+token(cgcAdmin)}});assert.equal(users.status,403);
 assert.equal((await call(cgcAdmin,'/'+id+'/review','POST',{revision:8,status:'published',note:'CGC reviewer approved the synthetic work.'})).status,200);
 assert.equal((await call(admin,'/'+id+'/review','POST',{revision:9,status:'archived',note:'Normal SARVA admin can still manage all CGC work.'})).status,200);
 await pool.query("DELETE FROM sarva.app_user_role WHERE user_id=$1 AND role_id=(SELECT id FROM sarva.auth_role WHERE name='cgc-admin')",[cgcAdmin]);
 assert.equal((await call(cgcAdmin,'/review')).status,403);
 await pool.query("DELETE FROM sarva.app_user_role WHERE user_id=$1 AND role_id=(SELECT id FROM sarva.auth_role WHERE name='cgc-user')",[other]);
 assert.equal((await call(other,'','POST',draft)).status,403);
});
test('revoked admin and inactive account lose access immediately',async()=>{
 await pool.query("DELETE FROM sarva.app_user_role WHERE user_id=$1 AND role_id=(SELECT id FROM sarva.auth_role WHERE name='admin')",[admin]);assert.equal((await call(admin,'/review')).status,403);await pool.query('UPDATE sarva.app_user SET is_active=false WHERE id=$1',[owner]);assert.equal((await call(owner,'/mine')).status,401);
});
