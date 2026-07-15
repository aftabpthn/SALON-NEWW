import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { authDeviceId, AuthApiEnvelope, LoginResponse } from './auth.service';

export interface PasskeyInfo {
  id: string;
  credentialId: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
}

interface RegistrationStart {
  challengeId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

interface AuthenticationStart {
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

interface PublicKeyCredentialCreationOptionsJSON extends Omit<PublicKeyCredentialCreationOptions, 'challenge' | 'user' | 'excludeCredentials'> {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, 'id'> & { id: string };
  excludeCredentials?: Array<Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string }>;
}

interface PublicKeyCredentialRequestOptionsJSON extends Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'> {
  challenge: string;
  allowCredentials?: Array<Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string }>;
}

@Injectable({ providedIn: 'root' })
export class WebauthnService {
  private readonly http = inject(HttpClient);

  get supported(): boolean {
    return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
  }

  async register(label: string): Promise<PasskeyInfo> {
    this.requireSupport();
    const begin = this.unwrap(await firstValueFrom(
      this.http.post<AuthApiEnvelope<RegistrationStart>>(
        `${environment.apiBaseUrl}/auth/webauthn/register/begin`,
        { label },
      ),
    ), 'Unable to start passkey registration');
    const publicKey = begin.options;
    const credential = await navigator.credentials.create({
      publicKey: {
        ...publicKey,
        challenge: decode(publicKey.challenge),
        user: { ...publicKey.user, id: decode(publicKey.user.id) },
        excludeCredentials: publicKey.excludeCredentials?.map((item) => ({
          ...item,
          id: decode(item.id),
        })),
      },
    }) as PublicKeyCredential | null;
    if (!credential) throw new Error('Passkey registration was cancelled');
    return this.unwrap(await firstValueFrom(
      this.http.post<AuthApiEnvelope<PasskeyInfo>>(
        `${environment.apiBaseUrl}/auth/webauthn/register/finish`,
        { challengeId: begin.challengeId, credential: registrationResponse(credential) },
      ),
    ), 'Unable to finish passkey registration');
  }

  async login(tenantContext: string, loginId: string): Promise<LoginResponse> {
    this.requireSupport();
    const headers = new HttpHeaders({ 'x-tenant-id': tenantContext });
    const begin = this.unwrap(await firstValueFrom(
      this.http.post<AuthApiEnvelope<AuthenticationStart>>(
        `${environment.apiBaseUrl}/auth/webauthn/login/begin`,
        { loginId: loginId.trim() },
        { headers },
      ),
    ), 'Passkey sign-in is unavailable');
    const publicKey = begin.options;
    const credential = await navigator.credentials.get({
      publicKey: {
        ...publicKey,
        challenge: decode(publicKey.challenge),
        allowCredentials: publicKey.allowCredentials?.map((item) => ({
          ...item,
          id: decode(item.id),
        })),
      },
    }) as PublicKeyCredential | null;
    if (!credential) throw new Error('Passkey sign-in was cancelled');
    return this.unwrap(await firstValueFrom(
      this.http.post<AuthApiEnvelope<LoginResponse>>(
        `${environment.apiBaseUrl}/auth/webauthn/login/finish`,
        { challengeId: begin.challengeId, credential: authenticationResponse(credential), deviceId: authDeviceId() },
        { headers },
      ),
    ), 'Unable to sign in with passkey');
  }

  private requireSupport(): void {
    if (!this.supported) throw new Error('This browser does not support passkeys');
  }

  private unwrap<T>(response: AuthApiEnvelope<T>, fallback: string): T {
    if (response.success && response.data !== undefined) return response.data;
    throw new Error(response.error?.message || fallback);
  }
}

function decode(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function encode(value: ArrayBuffer): string {
  const binary = Array.from(new Uint8Array(value), (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function registrationResponse(credential: PublicKeyCredential): unknown {
  const response = credential.response as AuthenticatorAttestationResponse & {
    getTransports?: () => string[];
  };
  return {
    id: encode(credential.rawId),
    transports: response.getTransports?.() ?? [],
    attestationObject: encode(response.attestationObject),
    clientDataJSON: encode(response.clientDataJSON),
  };
}

function authenticationResponse(credential: PublicKeyCredential): unknown {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: encode(credential.rawId),
    authenticatorData: encode(response.authenticatorData),
    signature: encode(response.signature),
    clientDataJSON: encode(response.clientDataJSON),
    userHandle: response.userHandle ? encode(response.userHandle) : null,
  };
}
