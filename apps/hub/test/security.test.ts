import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hash, openStore } from '../src/store.ts';

test('isolates extension ownership, expires sources and revokes agent access', async () => {
  const directory=mkdtempSync(join(tmpdir(),'mediahunter-security-'));
  const store=openStore(directory);
  let time=Date.now();
  const app=await buildApp(store,[],()=>time,{sourceTTL:1000,historyTTL:10_000});
  const first=randomUUID(), second=randomUUID(), agent=randomUUID();
  const tokens=['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)];
  for (const [index,id] of [first,second,agent].entries()) {
    store.db.prepare('INSERT INTO devices (id,kind,name,token_hash,last_seen) VALUES (?,?,?,?,?)')
      .run(id,index===2?'windows_agent':'extension','fixture',hash(tokens[index]),time);
  }
  const post=(path:string,body:object,token=tokens[0])=>app.inject({
    method:'POST',url:'/api/v1'+path,payload:body,headers:{authorization:'Bearer '+token},
  });
  try {
    const scan=(await post('/scans',{pageOrigin:'https://example.com',candidates:[{
      url:'https://example.com/image.png?signature=synthetic',mediaType:'image',source:'dom',format:'png',width:null,height:null,
    }]})).json<{candidateIds:string[]}>();
    const input={candidateId:scan.candidateIds[0],targetAgentId:agent,idempotencyKey:randomUUID()};
    expect((await post('/jobs',input,tokens[1])).statusCode).toBe(404);
    const added=(await post('/jobs',input)).json<{id:string}>();
    expect((await post('/jobs/'+added.id+'/cancel',{},tokens[1])).statusCode).toBe(409);
    expect((await post('/jobs/'+added.id+'/open',{action:'file'})).statusCode).toBe(404);
    time+=1001;
    await app.inject({url:'/api/v1/jobs',headers:{authorization:'Bearer '+tokens[0]}});
    expect(store.db.prepare('SELECT source FROM candidates').all()).toHaveLength(0);
    expect((store.db.prepare('SELECT state FROM jobs WHERE id=?').get(added.id) as {state:string}).state).toBe('rescan_required');
    store.db.prepare('UPDATE devices SET revoked=? WHERE id=?').run(time,agent);
    expect((await post('/agent/jobs/lease',{},tokens[2])).statusCode).toBe(401);
  } finally {await app.close();store.db.close();rmSync(directory,{recursive:true,force:true});}
});
