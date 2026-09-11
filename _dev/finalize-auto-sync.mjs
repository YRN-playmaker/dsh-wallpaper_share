import fs from 'node:fs';
const p='src/launcher/routes.ts';let s=fs.readFileSync(p,'utf8');
const full="{ present: v !== '', account: mask, validated: v !== '' && v === validatedBaiduCookie, revision: baiduRevision }";
s=s.replace(full,"{ present: v !== '', account: mask }");
const start=s.indexOf('  const authBaidu:');s=s.slice(0,start)+s.slice(start).replace("{ present: v !== '', account: mask }",full);
fs.writeFileSync(p,s,'utf8');