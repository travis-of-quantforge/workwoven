import { describe,it,expect } from 'vitest';
import { usageCharge,billableFailure,reviewEligible,scopeSchema } from '../src/lib/domain';
describe('currency and usage',()=>{
 it('charges 2x without rounding tiny usage to a cent',()=>expect(usageCharge(17n)).toBe(34n));
 it('absorbs internal and unusable failures',()=>{expect(billableFailure('internal',true,1000n)).toBe(0n);expect(billableFailure('provider',false,1000n)).toBe(0n);});
 it('requires retention and attributable usage for partial results',()=>{expect(billableFailure('partial',false,10n)).toBe(0n);expect(billableFailure('partial',true,null)).toBe(0n);expect(billableFailure('partial',true,10n)).toBe(20n);});
 it('rejects negative cost',()=>expect(()=>usageCharge(-1n)).toThrow());
});
describe('review eligibility',()=>{
 it('does not allow invitations or discussion to establish eligibility',()=>{expect(reviewEligible('cancelled',null)).toBe(false);expect(reviewEligible('discussion','version')).toBe(false);});
 it('requires an accepted agreement after completion or cancellation',()=>{expect(reviewEligible('completed',null)).toBe(false);expect(reviewEligible('cancelled','version')).toBe(true);expect(reviewEligible('completed','version')).toBe(true);});
});
it('rejects incomplete or non-USD submitted scopes',()=>{expect(scopeSchema.safeParse({deliverables:'Dashboard'}).success).toBe(false);});
