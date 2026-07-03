import crypto from "crypto";

export const now = () => new Date().toISOString();
export const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
