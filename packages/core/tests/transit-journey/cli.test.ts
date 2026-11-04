import { describe,it,expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const file=fileURLToPath(new URL('../../../../scripts/demo-transit-journey.mjs',import.meta.url));
describe('internal journey CLI argument boundary',()=>{
 it('shows local usage without starting a server',()=>{const r=spawnSync(process.execPath,[file,'--help'],{encoding:'utf8'});expect(r.status).toBe(0);expect(r.stdout).toContain('--from');});
 it.each([['--unknown'],['--line','1','--line','2'],['--from','METRO-101']].map(args=>({args})))('rejects ambiguous or incomplete arguments $args',({args})=>{const r=spawnSync(process.execPath,[file,...args],{encoding:'utf8'});expect(r.status).toBe(1);expect(r.stderr).toMatch(/Usage|argument/i);});
});
