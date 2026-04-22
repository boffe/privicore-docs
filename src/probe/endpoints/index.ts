/**
 * Registry of endpoint probe modules. One module per documented
 * endpoint. The CLI picks a module by its `id` and runs it.
 *
 * Adding a new probe:
 *   1. Create `src/probe/endpoints/<tag>-<op>.ts` exporting an
 *      `EndpointProbe`.
 *   2. Import and register it in PROBES below.
 *   3. Run `npm run probe -- --endpoint <id>`.
 */

import type { EndpointDoc } from "../../ir/types.ts";

// Public / auth
import { probeProfileAuthenticate } from "./profile-authenticate.ts";

// Sync, read-only.
import { probeUtilityCheckServerHealth } from "./utility-check-server-health.ts";
import { probeUtilityRequestCommandIdStatus } from "./utility-request-command-id-status.ts";
import { probeProfileRetrieveProfileId } from "./profile-retrieve-profile-id.ts";
import { probeProfileRetrieveTokenExpiry } from "./profile-retrieve-token-expiry.ts";
import { probeProfileGenerateQrToken } from "./profile-generate-qr-token-for-authorization.ts";
import { probePublicKeyRetrievePublicKey } from "./public-key-retrieve-public-key.ts";
import { probePublicKeyRetrieveCabPublicKey } from "./public-key-retrieve-cab-public-key.ts";
import { probeDataTokenListDataTokens } from "./data-token-list-data-tokens.ts";
import { probeDeviceRetrieveProfileDevices } from "./device-retrieve-profile-devices.ts";
import { probeStorageListStorageDevices } from "./storage-list-storage-devices.ts";
import { probeOauthOauthApplicationList } from "./oauth-oauth-application-list.ts";
import { probePolicyListPolicyTemplates } from "./policy-list-policy-templates.ts";

// Async-command, standalone.
import { probeProfileRegisterProfile } from "./profile-register-profile.ts";
import { probeDataTokenReserveTokenSpace } from "./data-token-reserve-token-space.ts";
import { probeDeviceRequestDeviceId } from "./device-request-device-id.ts";
import { probeVerifiedAuthenticatorVotingConfigurationCreate } from "./verified-authenticator-voting-configuration-create.ts";
import { probeOauthRegisterOauthApplication } from "./oauth-register-oauth-application.ts";

// Setup-chain.
import { probeDeviceRetrieveDeviceId } from "./device-retrieve-device-id.ts";
import { probeOauthRetrieveOauthAppConfiguration } from "./oauth-retrieve-oauth-app-configuration.ts";

// Best-effort (synthetic input).
import { probeVotingCheckPoolStatus } from "./voting-check-pool-status.ts";

// Async-command / sync with setup chain.
import { probeDeviceApproveDevice } from "./device-approve-device.ts";
import { probeDeviceConfigureDeviceMeta } from "./device-configure-device-meta.ts";
import { probeDeviceDownloadDeviceConfiguration } from "./device-download-device-configuration.ts";
import { probeStorageRegisterStorageDevice } from "./storage-register-storage-device.ts";
import { probeVerifiedAuthenticatorRegisterAuthenticator } from "./verified-authenticator-register-authenticator.ts";
import { probeDataTokenRetrieveTemporaryDataToken } from "./data-token-retrieve-temporary-data-token.ts";
import { probeDataTokenExchangeDataForToken } from "./data-token-exchange-data-for-token.ts";
import { probeDataTokenConfigureFileMeta } from "./data-token-configure-file-meta.ts";
import { probeDataTokenRequestData } from "./data-token-request-data.ts";
import { probeDataTokenUpdateDataToken } from "./data-token-update-data-token.ts";
import { probeDataTokenConfigureInformationSecurityRiskMeta } from "./data-token-configure-information-security-risk-meta.ts";
import { probePolicyRegisterPolicy } from "./policy-register-policy.ts";
import { probePolicyActivatePolicy } from "./policy-activate-policy.ts";

// Final batch: crypto-needed, token-lifecycle, destructive, OAuth full flow.
import { probePublicKeyRegisterPublicKey } from "./public-key-register-public-key.ts";
import { probeProfileReauthorizeAuthorizationToken } from "./profile-reauthorize-authorization-token.ts";
import { probeProfileRevokeAuthorizationToken } from "./profile-revoke-authorization-token.ts";
import { probeProfileChangePassword } from "./profile-change-password.ts";
import { probeDataTokenDeleteData } from "./data-token-delete-data.ts";
import { probeDeviceRejectDevice } from "./device-reject-device.ts";
import { probeDeviceRemoveDevice } from "./device-remove-device.ts";
import { probeStorageRemoveStorage } from "./storage-remove-storage.ts";
import { probePolicyDeactivatePolicy } from "./policy-deactivate-policy.ts";
import { probeOauthRequestOauthAppAuthorizationCode } from "./oauth-request-oauth-app-authorization-code.ts";
import { probeOauthObtainOauthAppAccessToken } from "./oauth-obtain-oauth-app-access-token.ts";
import { probeOauthRefreshOauthAppAccessToken } from "./oauth-refresh-oauth-app-access-token.ts";

export interface ProbeContext {
  /** Base URL for the Privicore CAB API. */
  apiUrl: string;
  /** WebSocket URL for the proxy. */
  wsUrl: string;
  /** Credentials for probe runs that need an authenticated session. */
  username: string;
  password: string;
}

/** An individual endpoint probe module. */
export interface EndpointProbe {
  /** Canonical id — matches the IR EndpointDoc.id. */
  id: string;
  /** One-line summary shown in `--help`-style output. */
  summary: string;
  /** Probes that delete / invalidate state. CLI gates them behind
   *  `--allow-destructive` so they're not run accidentally. */
  destructive?: boolean;
  /** Run the probe and return a fresh EndpointDoc. Pure w.r.t. disk —
   *  the CLI merges and writes. */
  run(ctx: ProbeContext): Promise<EndpointDoc>;
}

const PROBES: EndpointProbe[] = [
  // Public / auth.
  probeProfileAuthenticate,
  probeProfileRegisterProfile,

  // Sync read-only.
  probeUtilityCheckServerHealth,
  probeUtilityRequestCommandIdStatus,
  probeProfileRetrieveProfileId,
  probeProfileRetrieveTokenExpiry,
  probeProfileGenerateQrToken,
  probePublicKeyRetrievePublicKey,
  probePublicKeyRetrieveCabPublicKey,
  probeDataTokenListDataTokens,
  probeDeviceRetrieveProfileDevices,
  probeStorageListStorageDevices,
  probeOauthOauthApplicationList,
  probePolicyListPolicyTemplates,

  // Async-command, standalone.
  probeDataTokenReserveTokenSpace,
  probeDeviceRequestDeviceId,
  probeVerifiedAuthenticatorVotingConfigurationCreate,
  probeOauthRegisterOauthApplication,

  // Setup-chain.
  probeDeviceRetrieveDeviceId,
  probeOauthRetrieveOauthAppConfiguration,

  // Best-effort (synthetic input).
  probeVotingCheckPoolStatus,

  // Async-command / sync with setup chain.
  probeDeviceApproveDevice,
  probeDeviceConfigureDeviceMeta,
  probeDeviceDownloadDeviceConfiguration,
  probeStorageRegisterStorageDevice,
  probeVerifiedAuthenticatorRegisterAuthenticator,
  probeDataTokenRetrieveTemporaryDataToken,
  probeDataTokenExchangeDataForToken,
  probeDataTokenConfigureFileMeta,
  probeDataTokenRequestData,
  probeDataTokenUpdateDataToken,
  probeDataTokenConfigureInformationSecurityRiskMeta,
  probePolicyRegisterPolicy,
  probePolicyActivatePolicy,

  // Crypto-needed + token-lifecycle.
  probePublicKeyRegisterPublicKey,
  probeProfileReauthorizeAuthorizationToken,

  // Destructive (CLI gates behind --allow-destructive).
  probeProfileRevokeAuthorizationToken,
  probeProfileChangePassword,
  probeDataTokenDeleteData,
  probeDeviceRejectDevice,
  probeDeviceRemoveDevice,
  probeStorageRemoveStorage,
  probePolicyDeactivatePolicy,

  // OAuth full flow (consent → token → refresh).
  probeOauthRequestOauthAppAuthorizationCode,
  probeOauthObtainOauthAppAccessToken,
  probeOauthRefreshOauthAppAccessToken,
];

export function getProbe(id: string): EndpointProbe | undefined {
  return PROBES.find((p) => p.id === id);
}

export function listProbes(): EndpointProbe[] {
  return PROBES.slice();
}
