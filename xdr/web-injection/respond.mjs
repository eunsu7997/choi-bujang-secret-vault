import { createResponder as createCoreResponder } from '../respond-core.mjs';
import { decide } from './decide.mjs';

export function createResponder(options = {}) {
  return createCoreResponder({ ...options, moduleKey: 'web-injection', decide });
}
const worker = createResponder();
export const respond = alert => worker.respond(alert);
export const decideRequest = worker.wrapDecider();
export const RULE_IDS = worker.ruleIds;
