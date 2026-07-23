package com.aura.staff;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;

@CapacitorPlugin(name = "AttendanceBiometric")
public class AttendanceBiometricPlugin extends Plugin {
    private static final String KEY_ALIAS = "aura_attendance_install_key_v1";

    @PluginMethod
    public void getPublicKey(PluginCall call) {
        try {
            if (rejectIfBiometricUnavailable(call)) return;
            KeyPair keyPair = getOrCreateKeyPair();
            JSObject result = new JSObject();
            result.put("publicKeySpkiBase64", Base64.encodeToString(keyPair.getPublic().getEncoded(), Base64.NO_WRAP));
            result.put("biometricLabel", "device biometric");
            result.put("hardwareBacked", isHardwareBacked(keyPair.getPrivate()));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to create the secure attendance key.", "KEYSTORE_ERROR", error);
        }
    }

    @PluginMethod
    public void signNonce(PluginCall call) {
        String nonceBase64 = call.getString("nonceBase64");
        if (nonceBase64 == null || nonceBase64.isEmpty()) { call.reject("The attendance challenge is missing.", "INVALID_CHALLENGE"); return; }
        try {
            if (rejectIfBiometricUnavailable(call)) return;
            PrivateKey privateKey = getOrCreateKeyPair().getPrivate();
            Signature signature = Signature.getInstance("SHA256withECDSA");
            try {
                signature.initSign(privateKey);
            } catch (KeyPermanentlyInvalidatedException invalidated) {
                deleteKey();
                call.reject("Biometric enrollment changed. Re-register this device for owner approval.", "KEY_INVALIDATED");
                return;
            }
            BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) getActivity(), ContextCompat.getMainExecutor(getContext()), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    String code = errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON || errorCode == BiometricPrompt.ERROR_USER_CANCELED || errorCode == BiometricPrompt.ERROR_CANCELED
                        ? "BIOMETRIC_CANCELLED" : "BIOMETRIC_ERROR";
                    call.reject(code.equals("BIOMETRIC_CANCELLED") ? "Biometric verification was cancelled." : errString.toString(), code);
                }
                @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult authenticationResult) {
                    try {
                        Signature authenticated = authenticationResult.getCryptoObject() == null ? null : authenticationResult.getCryptoObject().getSignature();
                        if (authenticated == null) { call.reject("Biometric authentication did not unlock the attendance key.", "BIOMETRIC_ERROR"); return; }
                        byte[] nonce = Base64.decode(nonceBase64, Base64.DEFAULT);
                        authenticated.update(nonce);
                        JSObject result = new JSObject();
                        result.put("signatureBase64", Base64.encodeToString(authenticated.sign(), Base64.NO_WRAP));
                        result.put("biometricLabel", "device biometric");
                        call.resolve(result);
                    } catch (Exception error) { call.reject("Unable to sign the attendance challenge.", "SIGNING_ERROR", error); }
                }
            });
            BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Verify attendance")
                .setSubtitle("Use your enrolled fingerprint or face biometric")
                .setNegativeButtonText("Cancel")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build();
            prompt.authenticate(promptInfo, new BiometricPrompt.CryptoObject(signature));
        } catch (Exception error) {
            call.reject("Unable to access the secure attendance key.", "KEYSTORE_ERROR", error);
        }
    }

    private boolean rejectIfBiometricUnavailable(PluginCall call) {
        int status = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        if (status == BiometricManager.BIOMETRIC_SUCCESS) return false;
        if (status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) call.reject("No strong biometric is enrolled. Enrol a fingerprint or face biometric in Android settings.", "BIOMETRIC_NOT_ENROLLED");
        else if (status == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE) call.reject("Strong biometric authentication is not supported on this device.", "BIOMETRIC_UNSUPPORTED");
        else call.reject("Strong biometric authentication is currently unavailable.", "BIOMETRIC_UNAVAILABLE");
        return true;
    }

    private KeyPair getOrCreateKeyPair() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return new KeyPair(keyStore.getCertificate(KEY_ALIAS).getPublicKey(), (PrivateKey) keyStore.getKey(KEY_ALIAS, null));
        }
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        else builder.setUserAuthenticationValidityDurationSeconds(-1);
        generator.initialize(builder.build());
        return generator.generateKeyPair();
    }

    private void deleteKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
    }

    private boolean isHardwareBacked(PrivateKey privateKey) {
        try {
            KeyInfo info = KeyFactory.getInstance(privateKey.getAlgorithm(), "AndroidKeyStore").getKeySpec(privateKey, KeyInfo.class);
            return info.isInsideSecureHardware();
        } catch (Exception ignored) { return false; }
    }
}
