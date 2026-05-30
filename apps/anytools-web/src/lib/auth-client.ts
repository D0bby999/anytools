'use client';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  // Same-origin by default; override with NEXT_PUBLIC_AUTH_BASE_URL if auth lives elsewhere.
  baseURL: process.env.NEXT_PUBLIC_AUTH_BASE_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
