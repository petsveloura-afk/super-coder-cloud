#!/usr/bin/env node
// Wave 17 — generates the Web Push (VAPID) key pair. Put the values in Vercel
// Environment Variables (never in the repository):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT=mailto:you@your-domain
import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
console.log(`VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString("base64url")}`);
const d = ecdh.getPrivateKey();
console.log(`VAPID_PRIVATE_KEY=${Buffer.concat([Buffer.alloc(Math.max(0, 32 - d.length)), d]).toString("base64url")}`);
console.log("VAPID_SUBJECT=mailto:support@your-domain.com");
