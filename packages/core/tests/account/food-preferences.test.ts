import { describe,expect,it } from 'vitest';
import { validatePreferences } from '../../src/account/store.js';

describe('consented explicit food category preferences',()=>{
  it('accepts only category identifiers, up to four, in the exact user order',()=>{
    expect(validatePreferences({foodPreferredVerticals:['flowers','cafe']})).toEqual({
      ok:true,value:{foodPreferredVerticals:['flowers','cafe']}
    });
    expect(validatePreferences({foodPreferredVerticals:[]})).toEqual({ok:true,value:{foodPreferredVerticals:[]}});
  });
  it('rejects unknown, repeated and excessive categories',()=>{
    for(const foodPreferredVerticals of [
      ['flowers','flowers'],['flower'],['flowers','cafe','sweets','bakery','grocery'],[25], 'flowers',null
    ]) expect(validatePreferences({foodPreferredVerticals})).toMatchObject({ok:false,field:'foodPreferredVerticals'});
  });
  it('continues to reject arbitrary fields and unconsented history',()=>{
    expect(validatePreferences({history:[{lat:36.3,lon:59.5}]})).toMatchObject({ok:false});
  });
});
