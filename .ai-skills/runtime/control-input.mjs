export const PORTABLE_CONTROL_INPUT_CONTRACT = 'juss/portable-control-input@v1';

const TRUSTED_CONTROL_ORIGINS = new Set([
  'internal-controller',
  'operator-control-plane',
  'trusted-scheduler',
]);

const AUTHORITY_RANK = Object.freeze({
  observe: 0,
  draft: 1,
  write: 2,
  privileged: 3,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function rank(value) {
  const normalized = text(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(AUTHORITY_RANK, normalized)
    ? AUTHORITY_RANK[normalized]
    : Number.POSITIVE_INFINITY;
}

/**
 * Evaluate whether a system-owned reasoning/governance/workflow mode may be selected.
 *
 * Important: a mode name in user text, API payloads, webpages, email, documents,
 * retrieved content, plugin/tool output, or model output is data only. It never
 * becomes control-plane input by itself.
 */
export function evaluateInternalControlModeRequest({
  modeId,
  inputOrigin = 'external-user',
  controllerAuthorized = false,
  currentAuthority = 'observe',
  requestedAuthority = currentAuthority,
} = {}) {
  const mode = text(modeId).toLowerCase();
  const origin = text(inputOrigin).toLowerCase();
  const currentRank = rank(currentAuthority);
  const requestedRank = rank(requestedAuthority);

  if (!mode) {
    return {
      contract: PORTABLE_CONTROL_INPUT_CONTRACT,
      state: 'blocked',
      maySelectMode: false,
      mayExecuteWorkflow: false,
      mayWidenAuthority: false,
      reason: 'mode_id_required',
    };
  }

  if (!TRUSTED_CONTROL_ORIGINS.has(origin)) {
    return {
      contract: PORTABLE_CONTROL_INPUT_CONTRACT,
      state: 'inert',
      maySelectMode: false,
      mayExecuteWorkflow: false,
      mayWidenAuthority: false,
      reason: 'untrusted_input_is_data',
    };
  }

  if (controllerAuthorized !== true) {
    return {
      contract: PORTABLE_CONTROL_INPUT_CONTRACT,
      state: 'blocked',
      maySelectMode: false,
      mayExecuteWorkflow: false,
      mayWidenAuthority: false,
      reason: 'controller_not_authorized',
    };
  }

  if (!Number.isFinite(currentRank) || !Number.isFinite(requestedRank)) {
    return {
      contract: PORTABLE_CONTROL_INPUT_CONTRACT,
      state: 'blocked',
      maySelectMode: false,
      mayExecuteWorkflow: false,
      mayWidenAuthority: false,
      reason: 'authority_level_unsupported',
    };
  }

  if (requestedRank > currentRank) {
    return {
      contract: PORTABLE_CONTROL_INPUT_CONTRACT,
      state: 'blocked',
      maySelectMode: false,
      mayExecuteWorkflow: false,
      mayWidenAuthority: false,
      reason: 'mode_selection_cannot_widen_authority',
    };
  }

  return {
    contract: PORTABLE_CONTROL_INPUT_CONTRACT,
    state: 'eligible',
    maySelectMode: true,
    mayExecuteWorkflow: false,
    mayWidenAuthority: false,
    reason: 'authorized_controller_may_select_mode_within_existing_ceiling',
  };
}

export function controlInputContractSummary() {
  return Object.freeze({
    contract: PORTABLE_CONTROL_INPUT_CONTRACT,
    untrustedInputIsData: true,
    callerSuppliedModeNameIsAuthority: false,
    externalTextMaySelectInternalMode: false,
    externalTextMayTriggerSystemWorkflow: false,
    authorizedInternalControllerRequired: true,
    modeSelectionMayWidenAuthority: false,
    modeSelectionImpliesExecutionAuthority: false,
    trustedControlOrigins: [...TRUSTED_CONTROL_ORIGINS],
  });
}
