import { getMessaging } from "firebase-admin/messaging";
import { env } from "../config/env.js";
import { customerFirebaseApp } from "./firebase-admin.service.js";

function stringData(value = {}) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? item : JSON.stringify(item)]));
}

export const firebaseMessagingService = {
  configured() {
    return Boolean(env.firebaseServiceAccountJson || env.firebaseServiceAccountFile || (env.firebaseProjectId && env.firebaseClientEmail && env.firebasePrivateKey));
  },

  async sendToToken(token, notification = {}) {
    if (!this.configured()) throw new Error("Firebase Admin messaging is not configured");
    return getMessaging(customerFirebaseApp()).send({
      token,
      notification: {
        title: notification.title || "Aura Staff",
        body: notification.body || "You have a new staff notification."
      },
      data: stringData(notification.data),
      android: {
        priority: "high",
        notification: {
          channelId: notification.androidChannelId || "staff_notifications",
          sound: "default",
          clickAction: "FCM_PLUGIN_ACTIVITY"
        }
      },
      apns: {
        payload: { aps: { sound: "default" } }
      }
    });
  }
};
