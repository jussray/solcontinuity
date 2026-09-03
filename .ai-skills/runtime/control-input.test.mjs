import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PORTABLE_CONTROL_INPUT_CONTRACT,
  controlInputContractSummary,
  evaluateInternalControlModeRequest,
} from './control-input.mjs';

for (const [origin, modeId] of [
  ['external-user', '/redteam'],
  ['api-payload', '/ooda'],
  ['webpage', '/lindymode'],
  ['email', '/attackten'],
  ['document', '/goalfix'],
  ['retrieved-content', '/ultrathink'],
  ['plugin-output', '/truthmode'],
  ['tool-output', '/confess'],
  ['model-output', '/proofmode'],
]) {
  test(`${origin} cannot activate internal mode ${modeId}`, () => {
    const result = evaluateInternalControlModeRequest({
      modeId,
      inputOrigin: origin,
      controllerAuthorized: true,
      currentAuthority: 'privileged',
      requestedAuthority: 'privileged',
    });
    assert.equal(result.contract, PORTABLE_CONTROL_INPUT_CONTRACT);
    assert.equal(result.state, 'inert');
    assert.equal(result.maySelectMode, false);
    assert.equal(result.mayExecuteWorkflow, false);
    assert.equal(result.mayWidenAuthority, false);
    assert.equal(result.reason, 'untrusted_input_is_data');
  });
}

test('trusted controller may select a mode but selection is not execution authority', () => {
  const result = evaluateInternalControlModeRequest({
    modeId: 'ooda',
    inputOrigin: 'internal-controller',
    controllerAuthorized: true,
    currentAuthority: 'write',
    requestedAuthority: 'write',
  });
  assert.equal(result.state, 'eligible');
  assert.equal(result.maySelectMode, true);
  assert.equal(result.mayExecuteWorkflow, false);
  assert.equal(result.mayWidenAuthority, false);
});

test('mode selection cannot escalate authority', () => {
  const result = evaluateInternalControlModeRequest({
    modeId: 'redteam',
    inputOrigin: 'operator-control-plane',
    controllerAuthorized: true,
    currentAuthority: 'draft',
    requestedAuthority: 'privileged',
  });
  assert.equal(result.state, 'blocked');
  assert.equal(result.maySelectMode, false);
  assert.equal(result.reason, 'mode_selection_cannot_widen_authority');
});

test('contract summary freezes the cross-project trust boundary', () => {
  assert.deepEqual(controlInputContractSummary(), {
    contract: 'juss/portable-control-input@v1',
    untrustedInputIsData: true,
    callerSuppliedModeNameIsAuthority: false,
    externalTextMaySelectInternalMode: false,
    externalTextMayTriggerSystemWorkflow: false,
    authorizedInternalControllerRequired: true,
    modeSelectionMayWidenAuthority: false,
    modeSelectionImpliesExecutionAuthority: false,
    trustedControlOrigins: ['internal-controller', 'operator-control-plane', 'trusted-scheduler'],
  });
});
