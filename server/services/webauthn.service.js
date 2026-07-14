import { createHash, createPublicKey, createVerify, randomBytes, randomUUID, verify as cryptoVerify } from "node:crypto";
import { env } from "../config/env.js";
import { repositories } from "../repositories/repository-registry.js";
import { authService } from "./auth.service.js";
import { badRequest, unauthorized } from "../utils/app-error.js";
import { coseToJwk, decodeCbor, parseAuthData } from "../utils/webauthn-cbor.js";
import { securityEphemeralGrantStore } from "../stores/security-ephemeral-grant.store.js";

/**
 * WebAuthn / Passkeys (ADD-ONLY). Phishing-resistant login on top of TOTP.
 *
 * Credentials are stored in the existing encrypted_secrets table
 * (purpose='webauthn', name='webauthn:<userId>:<credId>'). Challenges are
 * carried in short-lived signed tokens (reuses authService.signJwt) so no
 * server-side challenge store is needed.
 */

const CHALLENGE_TTL = 300;
const PURPOSE = "webauthn";
const now = () => new Date().toISOString();
const makeId = (p) => `${p}_${randomUUID().slice(0, 10)}`;

function rpId() {
  return process.env.WEBAUTHN_RP_ID || (env.allowedOrigins[0] || "http://localhost:4300").replace(/^https?:\/\//, "").split(":")[0];
}
function expectedOrigins() {
  return env.allowedOrigins;
}

export class WebauthnService {
  constructor({ grantStore = securityEphemeralGrantStore } = {}) {
    this.grantStore = grantStore;
  }

  scope(access) { return { tenantId: access.tenantId }; }

  issueChallenge(ceremony, bindings, extra = {}) {
    const challenge = randomBytes(32).toString("base64url");
    const sessionNonce = randomBytes(32).toString("base64url");
    const token = authService.signJwt({
      typ: "webauthn_challenge",
      ceremony,
      challenge,
      sessionNonce,
      ...bindings,
      ...extra
    }, CHALLENGE_TTL);
    this.grantStore.issue({
      proof: token,
      ttlSeconds: CHALLENGE_TTL,
      type: "webauthn",
      purpose: ceremony,
      ...bindings,
      sessionId: ceremony === "auth" ? sessionNonce : bindings.sessionId,
      payload: {}
    });
    return { token, challenge, sessionNonce };
  }

  consumeChallenge(token, expectedCeremony, bindings) {
    const challenge = authService.verifyJwt(token);
    if (challenge.typ !== "webauthn_challenge" || challenge.ceremony !== expectedCeremony) throw unauthorized("Invalid WebAuthn challenge");
    const grant = this.grantStore.consume({
      proof: token,
      type: "webauthn",
      purpose: expectedCeremony,
      subjectId: bindings.subjectId,
      userId: bindings.userId,
      staffId: bindings.staffId,
      tenantId: bindings.tenantId,
      branchId: bindings.branchId,
      sessionId: bindings.sessionId
    });
    if (!grant) throw unauthorized("WebAuthn challenge is expired or already used");
    return challenge;
  }

  listCredentials(access) {
    return repositories.encryptedSecrets
      .list({ limit: 100000 }, this.scope(access))
      .filter((r) => r.purpose === PURPOSE && r.metadata?.userId === access.userId)
      .map((r) => ({ id: r.metadata.credentialId, label: r.metadata.label || "Passkey", createdAt: r.metadata.createdAt, lastUsedAt: r.metadata.lastUsedAt || "" }));
  }

  beginRegistration(access, { label = "Passkey" } = {}) {
    if (!access.jti) throw unauthorized("WebAuthn registration requires an authenticated session");
    const bindings = { subjectId: access.userId, userId: access.userId, staffId: access.staffId || "", tenantId: access.tenantId, branchId: access.branchId || "", sessionId: access.jti };
    const issued = this.issueChallenge("register", bindings, { sub: access.userId, label });
    return {
      challengeToken: issued.token,
      publicKey: {
        rp: { name: "Aura Salon CRM", id: rpId() },
        user: { id: Buffer.from(access.userId).toString("base64url"), name: access.loginId || access.userId, displayName: access.loginId || access.userId },
        challenge: issued.challenge,
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        timeout: CHALLENGE_TTL * 1000,
        authenticatorSelection: { userVerification: access.staffId ? "required" : "preferred" },
        attestation: "none"
      }
    };
  }

  finishRegistration(access, { challengeToken: token, id, rawId, response } = {}) {
    if (!token || !response?.clientDataJSON || !response?.attestationObject) throw badRequest("Missing registration response");
    const challenge = authService.verifyJwt(token);
    if (challenge.typ !== "webauthn_challenge" || challenge.ceremony !== "register") throw unauthorized("Invalid WebAuthn challenge");
    if (challenge.sub !== access.userId) throw unauthorized("Challenge does not belong to this user");

    const clientData = JSON.parse(Buffer.from(response.clientDataJSON, "base64url").toString("utf8"));
    if (clientData.type !== "webauthn.create") throw badRequest("Unexpected ceremony type");
    if (clientData.challenge !== challenge.challenge) throw unauthorized("Challenge mismatch");
    if (!expectedOrigins().includes(clientData.origin)) throw unauthorized("Origin not allowed");

    const { value: attestation } = decodeCbor(Buffer.from(response.attestationObject, "base64url"));
    const authData = parseAuthData(attestation.get("authData"));
    if (!authData.credentialPublicKey) throw badRequest("No credential public key");
    const { jwk, alg } = coseToJwk(authData.credentialPublicKey);
    const credentialId = id || rawId || Buffer.from(authData.credentialId).toString("base64url");

    this.consumeChallenge(token, "register", {
      subjectId: access.userId,
      userId: access.userId,
      staffId: access.staffId || "",
      tenantId: access.tenantId,
      branchId: access.branchId || "",
      sessionId: access.jti || ""
    });

    repositories.encryptedSecrets.create({
      id: makeId("wacred"),
      name: `webauthn:${access.userId}:${credentialId}`,
      purpose: PURPOSE,
      algorithm: alg,
      iv: "", authTag: "", ciphertext: "",
      status: "active",
      metadata: { userId: access.userId, credentialId, jwk, alg, signCount: authData.signCount, label: challenge.label || "Passkey", createdAt: now() }
    }, this.scope(access));
    return { registered: true, credentialId };
  }

  beginAuthentication({ tenantId, userId }) {
    const user = repositories.tenantUsers.getById(userId, { tenantId });
    if (!user || user.status !== "active") throw unauthorized("Account is no longer active");
    const creds = repositories.encryptedSecrets
      .list({ limit: 100000 }, { tenantId })
      .filter((r) => r.purpose === PURPOSE && r.metadata?.userId === userId);
    if (!creds.length) throw badRequest("No passkeys registered");
    const bindings = { subjectId: userId, userId, staffId: user.staffId || "", tenantId, branchId: "", sessionId: "" };
    const issued = this.issueChallenge("auth", bindings, { sub: userId });
    return {
      challengeToken: issued.token,
      publicKey: {
        challenge: issued.challenge,
        rpId: rpId(),
        timeout: CHALLENGE_TTL * 1000,
        userVerification: user.staffId ? "required" : "preferred",
        allowCredentials: creds.map((c) => ({ type: "public-key", id: c.metadata.credentialId }))
      }
    };
  }

  finishAuthentication({ challengeToken: token, id, response } = {}) {
    if (!token || !response?.clientDataJSON || !response?.authenticatorData || !response?.signature) throw badRequest("Missing assertion response");
    const challenge = authService.verifyJwt(token);
    if (challenge.typ !== "webauthn_challenge" || challenge.ceremony !== "auth") throw unauthorized("Invalid WebAuthn challenge");

    const clientData = JSON.parse(Buffer.from(response.clientDataJSON, "base64url").toString("utf8"));
    if (clientData.type !== "webauthn.get") throw badRequest("Unexpected ceremony type");
    if (clientData.challenge !== challenge.challenge) throw unauthorized("Challenge mismatch");
    if (!expectedOrigins().includes(clientData.origin)) throw unauthorized("Origin not allowed");

    const record = repositories.encryptedSecrets
      .list({ limit: 100000 }, { tenantId: challenge.tenantId })
      .find((r) => r.purpose === PURPOSE && r.metadata?.userId === challenge.sub && r.metadata?.credentialId === id);
    if (!record) throw unauthorized("Unknown credential");

    const authData = Buffer.from(response.authenticatorData, "base64url");
    const parsed = parseAuthData(authData);
    const expectedRpIdHash = createHash("sha256").update(rpId()).digest();
    if (!parsed.rpIdHash.equals(expectedRpIdHash)) throw unauthorized("RP ID hash mismatch");
    if (!parsed.userPresent) throw unauthorized("User presence flag not set");
    const user = repositories.tenantUsers.getById(challenge.sub, { tenantId: challenge.tenantId });
    if (!user || user.status !== "active") throw unauthorized("Account is no longer active");
    if (user.staffId && !parsed.userVerified) throw unauthorized("Staff passkey requires user verification");

    const clientDataHash = createHash("sha256").update(Buffer.from(response.clientDataJSON, "base64url")).digest();
    const signedData = Buffer.concat([authData, clientDataHash]);
    const signature = Buffer.from(response.signature, "base64url");
    const keyObject = createPublicKey({ key: record.metadata.jwk, format: "jwk" });

    let ok;
    if (record.metadata.alg === "ES256") {
      ok = cryptoVerify("sha256", signedData, { key: keyObject, dsaEncoding: "der" }, signature);
    } else {
      const v = createVerify("RSA-SHA256"); v.update(signedData); v.end();
      ok = v.verify(keyObject, signature);
    }
    if (!ok) throw unauthorized("Invalid passkey signature");

    // Clone-detection: signCount must move forward (unless authenticator reports 0).
    if (parsed.signCount !== 0 && parsed.signCount <= (record.metadata.signCount || 0)) {
      throw unauthorized("Possible cloned authenticator (sign count regression)");
    }
    this.consumeChallenge(token, "auth", {
      subjectId: challenge.subjectId,
      userId: challenge.userId,
      staffId: challenge.staffId,
      tenantId: challenge.tenantId,
      branchId: challenge.branchId,
      sessionId: challenge.sessionNonce
    });
    repositories.encryptedSecrets.update(record.id, {
      metadata: { ...record.metadata, signCount: parsed.signCount, lastUsedAt: now() }
    }, { tenantId: challenge.tenantId });

    return { verified: true, userId: challenge.sub, tenantId: challenge.tenantId };
  }
}

export const webauthnService = new WebauthnService();
